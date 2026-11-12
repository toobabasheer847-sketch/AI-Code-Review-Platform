import { performance } from 'node:perf_hooks'
import ts from 'typescript'

import type { ReviewSourceFile } from '@/modules/github/github.service'
import type { ReviewFinding } from './analyzer'
import { stampMeasuredFinding, type IssueClass, type RiskLevel } from './review-intelligence'
import {
  MAX_SECURITY_SCAN_FILE_BYTES,
  MAX_SECURITY_SCAN_FILES,
  MAX_SECURITY_SCAN_TOTAL_BYTES,
  redactUntrustedText,
} from './security-scanner'

export const MAX_PATTERN_SCAN_DURATION_MS = 1_000
export const MAX_PATTERN_SCAN_FINDINGS = 100

const supportedExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const sqlMethods = new Set(['query', 'execute', 'raw', 'queryRaw', 'queryRawUnsafe', '$queryRawUnsafe'])
const queryMethods = new Set([
  'query',
  'execute',
  'findMany',
  'findFirst',
  'findUnique',
  'queryRaw',
  '$queryRaw',
])
const sqlKeyword = /\b(select|insert|update|delete|drop|alter)\b/i
const safeEventName = /^[A-Za-z][\w:-]{0,40}$/

export interface PatternScanResult {
  findings: ReviewFinding[]
  limitations: string[]
}

interface PatternDraft {
  line: number
  title: string
  message: string
  impact: string
  suggestions: string[]
  remediationExample?: string
  category: ReviewFinding['category']
  confidence: number
  riskLevel: RiskLevel
  issueClass: IssueClass
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  )
}

function calledName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isParenthesizedExpression(expression)) return calledName(expression.expression)
  return null
}

function evidenceLine(content: string, line: number): string {
  return redactUntrustedText((content.split(/\r?\n/)[line - 1] ?? '').trim()).slice(0, 500)
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function hasDynamicPart(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) return hasDynamicPart(expression.expression)
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isNumericLiteral(expression)
  ) {
    return false
  }
  if (ts.isTemplateExpression(expression)) return true
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return hasDynamicPart(expression.left) || hasDynamicPart(expression.right)
  }
  return true
}

function literalSqlText(expression: ts.Expression): string {
  if (ts.isParenthesizedExpression(expression)) return literalSqlText(expression.expression)
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text
  if (ts.isTemplateExpression(expression)) {
    return [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join(' ')
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return `${literalSqlText(expression.left)} ${literalSqlText(expression.right)}`
  }
  return ''
}

function isDynamicSql(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) return isDynamicSql(expression.expression)
  if (ts.isTaggedTemplateExpression(expression)) return false
  return hasDynamicPart(expression) && sqlKeyword.test(literalSqlText(expression))
}

function containsAssignment(node: ts.Node): boolean {
  let found = false
  const visit = (child: ts.Node): void => {
    if (found || isFunctionLike(child)) return
    if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      found = true
      return
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

function isDiscardedCallback(node: ts.FunctionLikeDeclaration): boolean {
  const body = node.body
  if (!body) return false
  if (!ts.isBlock(body)) {
    return (
      body.kind === ts.SyntaxKind.NullKeyword ||
      body.kind === ts.SyntaxKind.UndefinedKeyword ||
      (ts.isIdentifier(body) && body.text === 'undefined')
    )
  }
  if (body.statements.length === 0) return true
  if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0])) return false
  const returned = body.statements[0].expression
  return (
    returned === undefined ||
    returned.kind === ts.SyntaxKind.NullKeyword ||
    returned.kind === ts.SyntaxKind.UndefinedKeyword ||
    (ts.isIdentifier(returned) && returned.text === 'undefined')
  )
}

function findQueryCall(root: ts.Node): ts.CallExpression | null {
  let found: ts.CallExpression | null = null
  const visit = (node: ts.Node): void => {
    if (found || (node !== root && isFunctionLike(node))) return
    if (ts.isCallExpression(node)) {
      const name = calledName(node.expression)
      if (name && queryMethods.has(name)) {
        found = node
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function isLoop(node: ts.Node): node is ts.ForStatement | ts.ForInStatement | ts.ForOfStatement | ts.WhileStatement | ts.DoStatement {
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  )
}

export function scanCodePatterns(
  files: ReviewSourceFile[],
  options: { now?: () => number; maxDurationMs?: number } = {}
): PatternScanResult {
  if (!Array.isArray(files)) {
    return { findings: [], limitations: ['Deterministic pattern checks skipped malformed source data.'] }
  }
  const now = options.now ?? performance.now.bind(performance)
  const startedAt = now()
  const maxDurationMs = options.maxDurationMs ?? MAX_PATTERN_SCAN_DURATION_MS
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    return { findings: [], limitations: ['Deterministic pattern checks skipped because the time budget was invalid.'] }
  }

  const findings: ReviewFinding[] = []
  const limitations: string[] = []
  const seen = new Set<string>()
  let totalBytes = 0
  let unsupportedFiles = 0
  let malformedFiles = 0
  let skippedOversized = false
  const filesToScan = files.slice(0, MAX_SECURITY_SCAN_FILES)
  if (files.length > MAX_SECURITY_SCAN_FILES) {
    limitations.push('Deterministic pattern checks skipped files beyond the static-analysis file limit.')
  }

  const push = (file: ReviewSourceFile, sourceFile: ts.SourceFile, node: ts.Node, draft: PatternDraft): void => {
    if (findings.length >= MAX_PATTERN_SCAN_FINDINGS) return
    const line = draft.line || lineOf(sourceFile, node)
    const onChangedLine =
      file.changedLines === undefined || file.changedLines.length === 0 || file.changedLines.includes(line)
    const evidence = evidenceLine(file.content, line)
    const key = `${file.path}:${line}:${draft.issueClass}`
    if (!onChangedLine || evidence.length < 3 || seen.has(key)) return
    seen.add(key)
    findings.push(
      stampMeasuredFinding(
        {
          file: file.path,
          line,
          endLine: line,
          severity: 'warning',
          category: draft.category,
          title: draft.title,
          message: draft.message,
          impact: draft.impact,
          evidence,
          suggestions: draft.suggestions,
          ...(draft.remediationExample ? { remediationExample: draft.remediationExample } : {}),
          source: 'STATIC_ANALYSIS' as const,
        },
        { confidence: draft.confidence, riskLevel: draft.riskLevel, issueClass: draft.issueClass }
      )
    )
  }

  for (const file of filesToScan) {
    if (now() - startedAt > maxDurationMs) {
      limitations.push('Deterministic pattern checks stopped after the time budget was reached.')
      break
    }
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') continue
    const extension = file.path.slice(file.path.lastIndexOf('.')).toLowerCase()
    if (!supportedExtensions.has(extension)) {
      unsupportedFiles += 1
      continue
    }
    const size = Buffer.byteLength(file.content, 'utf8')
    if (size > MAX_SECURITY_SCAN_FILE_BYTES) {
      skippedOversized = true
      continue
    }
    totalBytes += size
    if (totalBytes > MAX_SECURITY_SCAN_TOTAL_BYTES) {
      limitations.push('Deterministic pattern checks stopped after the source size budget was reached.')
      break
    }

    const scriptKind =
      extension === '.tsx' || extension === '.jsx'
        ? ts.ScriptKind.TSX
        : extension === '.js' || extension === '.mjs' || extension === '.cjs'
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS
    const sourceFile = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, scriptKind)
    const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics
    if (parseDiagnostics && parseDiagnostics.length > 0) {
      malformedFiles += 1
      continue
    }

    let visited = 0
    let timedOut = false
    const visit = (node: ts.Node): void => {
      if (timedOut || findings.length >= MAX_PATTERN_SCAN_FINDINGS) return
      visited += 1
      if (visited % 64 === 0 && now() - startedAt > maxDurationMs) {
        timedOut = true
        return
      }
      considerNode(file, sourceFile, node, push)
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    if (timedOut) {
      limitations.push('Deterministic pattern checks stopped after the time budget was reached.')
      break
    }
  }

  if (unsupportedFiles > 0) {
    limitations.push(
      `Deterministic pattern checks skipped ${unsupportedFiles} unsupported file(s); they currently support TypeScript and JavaScript.`
    )
  }
  if (malformedFiles > 0) {
    limitations.push(`Deterministic pattern checks skipped ${malformedFiles} file(s) with syntax errors.`)
  }
  if (skippedOversized) {
    limitations.push('Deterministic pattern checks skipped files that exceed the static-analysis size budget.')
  }
  return { findings, limitations }
}

function considerNode(
  file: ReviewSourceFile,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  push: (file: ReviewSourceFile, sourceFile: ts.SourceFile, node: ts.Node, draft: PatternDraft) => void
): void {
  if (ts.isCallExpression(node)) {
    const argument = node.arguments[0]
    const name = calledName(node.expression)
    if (name && sqlMethods.has(name) && argument && isDynamicSql(argument)) {
      push(file, sourceFile, node, {
        line: lineOf(sourceFile, node),
        category: 'security',
        title: 'SQL text is built from a dynamic value',
        message: 'A query, execute, or raw call builds SQL text with concatenation or interpolation.',
        impact: 'A value that reaches this text can change the query that the database executes.',
        suggestions: ['Pass the value as a bound parameter and keep the SQL text fixed.'],
        remediationExample: 'db.query(parameterizedSql, [value])',
        confidence: 0.9,
        riskLevel: 'high',
        issueClass: 'data_access',
      })
    }
    if (isEvalCall(node) || (ts.isIdentifier(node.expression) && node.expression.text === 'eval')) {
      push(file, sourceFile, node, {
        line: lineOf(sourceFile, node),
        category: 'security',
        title: 'Dynamic code execution',
        message: 'eval is called in the supplied source.',
        impact: 'Code passed to eval runs with the privileges of this process.',
        suggestions: ['Replace eval with a direct call to the specific operation that is required.'],
        remediationExample: 'runKnownAction(action)',
        confidence: 0.92,
        riskLevel: 'high',
        issueClass: 'security',
      })
    }
    if (isDynamicExec(node)) {
      push(file, sourceFile, node, {
        line: lineOf(sourceFile, node),
        category: 'security',
        title: 'Command is built from a dynamic value',
        message: 'exec or execSync receives a command that is not a fixed string literal.',
        impact: 'A value that reaches this command can change which program the process runs.',
        suggestions: ['Invoke a fixed executable with a separate argument list and shell disabled.'],
        remediationExample: 'spawn(executable, args, { shell: false })',
        confidence: 0.9,
        riskLevel: 'high',
        issueClass: 'security',
      })
    }
    if (name === 'catch' && node.arguments[0] && isFunctionLike(node.arguments[0]) && isDiscardedCallback(node.arguments[0])) {
      push(file, sourceFile, node, {
        line: lineOf(sourceFile, node),
        category: 'bug',
        title: 'Promise rejection is discarded',
        message: 'The catch callback is empty or returns a discarded value.',
        impact: 'A rejected promise can disappear, so the caller cannot tell that the operation failed.',
        suggestions: ['Log the rejection, rethrow it, or return a failure the caller can distinguish.'],
        confidence: 0.86,
        riskLevel: 'medium',
        issueClass: 'error_handling',
      })
    }
    if ((name === 'forEach' || name === 'map') && node.arguments[0] && isFunctionLike(node.arguments[0])) {
      const query = findQueryCall(node.arguments[0])
      if (query) push(file, sourceFile, query, loopQueryDraft(sourceFile, query))
    }
  }

  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
    push(file, sourceFile, node, {
      line: lineOf(sourceFile, node),
      category: 'security',
      title: 'Dynamic code execution',
      message: 'The Function constructor is used to create code at runtime.',
      impact: 'A string passed to Function runs with the privileges of this process.',
      suggestions: ['Call a specific function instead of compiling a string at runtime.'],
      remediationExample: 'runKnownAction(action)',
      confidence: 0.92,
      riskLevel: 'high',
      issueClass: 'security',
    })
  }

  if (ts.isTaggedTemplateExpression(node)) {
    const name = calledName(node.tag)
    if ((name === 'queryRawUnsafe' || name === '$queryRawUnsafe') && ts.isTemplateExpression(node.template)) {
      const text = [node.template.head.text, ...node.template.templateSpans.map((span) => span.literal.text)].join(' ')
      if (sqlKeyword.test(text)) {
        push(file, sourceFile, node, {
          line: lineOf(sourceFile, node),
          category: 'security',
          title: 'Unsafe SQL template includes interpolated values',
          message: 'queryRawUnsafe interpolates values into SQL text.',
          impact: 'An interpolated value can change the query that the database executes.',
          suggestions: ['Use a parameterized query API instead of an unsafe SQL template.'],
          remediationExample: 'db.query(parameterizedSql, [value])',
          confidence: 0.9,
          riskLevel: 'high',
          issueClass: 'data_access',
        })
      }
    }
  }

  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(node.left) &&
    node.left.name.text === 'innerHTML' &&
    hasDynamicPart(node.right)
  ) {
    push(file, sourceFile, node, {
      line: lineOf(sourceFile, node),
      category: 'security',
      title: 'HTML is assigned from a dynamic value',
      message: 'innerHTML is assigned from a value other than a fixed string.',
      impact: 'If that value contains markup, the page can execute it in the user browser.',
      suggestions: ['Assign text with textContent, or sanitize markup with a reviewed sanitizer before insertion.'],
      remediationExample: 'element.textContent = value',
      confidence: 0.82,
      riskLevel: 'high',
      issueClass: 'security',
    })
  }

  if (ts.isJsxAttribute(node) && node.name.getText() === 'dangerouslySetInnerHTML' && node.initializer) {
    if (containsNonHtmlIdentifier(node.initializer)) {
      push(file, sourceFile, node, {
        line: lineOf(sourceFile, node),
        category: 'security',
        title: 'HTML is assigned from a dynamic value',
        message: 'dangerouslySetInnerHTML receives a value other than a fixed string.',
        impact: 'If that value contains markup, the page can execute it in the user browser.',
        suggestions: ['Render text content, or sanitize markup with a reviewed sanitizer before insertion.'],
        remediationExample: 'element.textContent = value',
        confidence: 0.8,
        riskLevel: 'high',
        issueClass: 'security',
      })
    }
  }

  const condition = conditionOf(node)
  if (condition && containsAssignment(condition)) {
    push(file, sourceFile, condition, {
      line: lineOf(sourceFile, condition),
      category: 'bug',
      title: 'Assignment is used as a condition',
      message: 'The condition assigns a value instead of only comparing one.',
      impact: 'The branch can run because the assignment result is truthy or falsy, which is a different decision from a comparison.',
      suggestions: ['Use a comparison, or move the assignment out of the condition.'],
      remediationExample: 'if (user === null) {',
      confidence: 0.93,
      riskLevel: 'high',
      issueClass: 'logic',
    })
  }

  if (isLoop(node)) {
    const query = findQueryCall(node)
    if (query) push(file, sourceFile, query, loopQueryDraft(sourceFile, query))
  }

  if (isFunctionLike(node)) {
    const listener = findListenerLeak(node)
    if (listener) {
      push(file, sourceFile, listener.call, {
        line: lineOf(sourceFile, listener.call),
        category: 'quality',
        title: 'Event listener is not removed in this function',
        message: `addEventListener registers '${listener.eventName}' and this function does not call removeEventListener.`,
        impact: 'If this function runs more than once, the listener can remain attached after the caller is finished.',
        suggestions: ['Call removeEventListener with the same target and event name when the caller is finished.'],
        confidence: 0.74,
        riskLevel: 'low',
        issueClass: 'resource_management',
      })
    }
    const fetchCall = findUncheckedFetch(node)
    if (fetchCall) {
      push(file, sourceFile, fetchCall, {
        line: lineOf(sourceFile, fetchCall),
        category: 'bug',
        title: 'Response status is not checked before the body is read',
        message: 'fetch is followed by a body read in this function, and the function does not read response.ok or response.status.',
        impact: 'An error response can be treated as a successful payload.',
        suggestions: ['Check response.ok or response.status before reading the body.'],
        remediationExample: 'if (!response.ok) throw new Error("Request failed")',
        confidence: 0.68,
        riskLevel: 'medium',
        issueClass: 'api_contract',
      })
    }
  }
}

function loopQueryDraft(sourceFile: ts.SourceFile, query: ts.CallExpression): PatternDraft {
  return {
    line: lineOf(sourceFile, query),
    category: 'performance',
    title: 'Data-access call inside a loop',
    message:
      'A call named query, execute, or a single-record finder appears directly inside a loop. The supplied code does not show whether the call is batched.',
    impact:
      'If the call reaches a database once per item, the operation can issue more queries than a batched read. This is a potential risk, not a measured bottleneck.',
    suggestions: ['Load the rows with one query, or confirm that the repeated call is intentional.'],
    confidence: 0.72,
    riskLevel: 'medium',
    issueClass: 'data_access',
  }
}

function isEvalCall(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'eval') return false
  return (
    ts.isIdentifier(node.expression.expression) &&
    (node.expression.expression.text === 'window' || node.expression.expression.text === 'globalThis')
  )
}

function isDynamicExec(node: ts.CallExpression): boolean {
  const name = calledName(node.expression)
  if (name !== 'exec' && name !== 'execSync') return false
  if (ts.isPropertyAccessExpression(node.expression)) {
    const objectName = ts.isIdentifier(node.expression.expression) ? node.expression.expression.text : null
    if (objectName !== 'child_process' && objectName !== 'cp') return false
  }
  const argument = node.arguments[0]
  if (!argument) return false
  return !ts.isStringLiteral(argument) && !ts.isNoSubstitutionTemplateLiteral(argument)
}

function conditionOf(node: ts.Node): ts.Expression | undefined {
  if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) return node.expression
  if (ts.isForStatement(node)) return node.condition
  return undefined
}

function containsNonHtmlIdentifier(node: ts.Node): boolean {
  let found = false
  const visit = (child: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(child) && child.text !== '__html') found = true
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

function findListenerLeak(fn: ts.FunctionLikeDeclaration): { call: ts.CallExpression; eventName: string } | null {
  let call: ts.CallExpression | null = null
  let eventName = ''
  let removes = false
  const visit = (node: ts.Node, nested: boolean): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const objectName = ts.isIdentifier(node.expression.expression) ? node.expression.expression.text : null
      if (
        (objectName === 'window' || objectName === 'document') &&
        (method === 'addEventListener' || method === 'removeEventListener')
      ) {
        if (method === 'removeEventListener') removes = true
        const argument = node.arguments[0]
        if (
          !nested &&
          method === 'addEventListener' &&
          !call &&
          argument &&
          ts.isStringLiteral(argument) &&
          safeEventName.test(argument.text)
        ) {
          call = node
          eventName = argument.text
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, nested || (child !== node && isFunctionLike(child))))
  }
  visit(fn, false)
  return call && !removes ? { call, eventName } : null
}

function findUncheckedFetch(fn: ts.FunctionLikeDeclaration): ts.CallExpression | null {
  let fetchCall: ts.CallExpression | null = null
  let readsBody = false
  let checksStatus = false
  const visit = (node: ts.Node): void => {
    if (node !== fn && isFunctionLike(node)) return
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'fetch') fetchCall = node
      const name = calledName(node.expression)
      if (name === 'json' || name === 'text') readsBody = true
    }
    if (ts.isPropertyAccessExpression(node) && (node.name.text === 'ok' || node.name.text === 'status')) {
      checksStatus = true
    }
    ts.forEachChild(node, visit)
  }
  visit(fn)
  return fetchCall && readsBody && !checksStatus ? fetchCall : null
}
