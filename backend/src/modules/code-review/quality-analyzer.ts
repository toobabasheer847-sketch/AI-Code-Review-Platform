import ts from 'typescript'
import { performance } from 'node:perf_hooks'
import type { ReviewFinding } from './analyzer'
import {
  MAX_SECURITY_SCAN_DURATION_MS,
  MAX_SECURITY_SCAN_FILE_BYTES,
  MAX_SECURITY_SCAN_FILES,
  MAX_SECURITY_SCAN_TOTAL_BYTES,
} from './security-scanner'
import type { ReviewSourceFile } from '@/modules/github/github.service'

export const MAX_FUNCTION_CYCLOMATIC_COMPLEXITY = 10

const supportedExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])

const decisionOperators = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
])

export interface QualityAnalysisResult {
  findings: ReviewFinding[]
  limitations: string[]
}

export class QualityAnalysisError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QualityAnalysisError'
  }
}

function isFunctionLike(
  node: ts.Node
): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isArrowFunction(node)
  )
}

function functionName(node: ts.FunctionLikeDeclaration): string {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text
  if (ts.isMethodDeclaration(node) && node.name) {
    return node.name.getText().slice(0, 100)
  }
  return 'anonymous function'
}

function calculateComplexity(node: ts.FunctionLikeDeclaration): number {
  let complexity = 1
  const visit = (child: ts.Node): void => {
    if (child !== node && isFunctionLike(child)) return
    if (
      ts.isIfStatement(child) ||
      ts.isForStatement(child) ||
      ts.isForInStatement(child) ||
      ts.isForOfStatement(child) ||
      ts.isWhileStatement(child) ||
      ts.isDoStatement(child) ||
      ts.isConditionalExpression(child) ||
      ts.isCatchClause(child) ||
      (ts.isCaseClause(child) && child.expression !== undefined)
    ) {
      complexity += 1
    } else if (
      ts.isBinaryExpression(child) &&
      decisionOperators.has(child.operatorToken.kind)
    ) {
      complexity += 1
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return complexity
}

function buildFinding(
  file: string,
  content: string,
  node: ts.FunctionLikeDeclaration,
  complexity: number
): ReviewFinding {
  const sourceFile = node.getSourceFile()
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  const end = sourceFile.getLineAndCharacterOfPosition(node.end)
  const line = start.line + 1
  const endLine = Math.max(line, end.line + 1)
  const sourceLines = content.split(/\r?\n/)
  const evidence = sourceLines.slice(start.line, Math.min(end.line + 1, start.line + 5))
    .join('\n')
    .slice(0, 500)

  return {
    file,
    line,
    endLine,
    severity: 'warning',
    category: 'quality',
    title: 'High cyclomatic complexity',
    message: `${functionName(node)} has a measured cyclomatic complexity of ${complexity}, above the threshold of ${MAX_FUNCTION_CYCLOMATIC_COMPLEXITY}.`,
    impact:
      'Complex branching increases maintenance effort and the number of independent paths that may need testing.',
    evidence,
    suggestions: [
      'Consider extracting cohesive branches into named helper functions and add focused tests; review the refactor for behavior changes.',
    ],
    source: 'STATIC_ANALYSIS',
  }
}

export function analyzeCodeQuality(
  files: ReviewSourceFile[],
  options: { now?: () => number; maxDurationMs?: number } = {}
): QualityAnalysisResult {
  if (!Array.isArray(files)) {
    throw new QualityAnalysisError('Quality analysis received malformed source data')
  }
  if (files.length > MAX_SECURITY_SCAN_FILES) {
    throw new QualityAnalysisError('Quality analysis file limit exceeded')
  }

  const now = options.now ?? performance.now.bind(performance)
  const startedAt = now()
  const maxDurationMs = options.maxDurationMs ?? MAX_SECURITY_SCAN_DURATION_MS
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    throw new QualityAnalysisError('Invalid quality analysis time budget')
  }

  let totalBytes = 0
  let unsupportedFiles = 0
  let malformedFiles = 0
  const findings: ReviewFinding[] = []

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    if (
      !file ||
      typeof file.path !== 'string' ||
      file.path.length === 0 ||
      typeof file.content !== 'string'
    ) {
      throw new QualityAnalysisError('Quality analysis received malformed source data')
    }

    const size = Buffer.byteLength(file.content, 'utf8')
    if (size > MAX_SECURITY_SCAN_FILE_BYTES) {
      throw new QualityAnalysisError('Quality analysis file size limit exceeded')
    }
    totalBytes += size
    if (totalBytes > MAX_SECURITY_SCAN_TOTAL_BYTES) {
      throw new QualityAnalysisError('Quality analysis total size limit exceeded')
    }

    const extension = file.path.slice(file.path.lastIndexOf('.')).toLowerCase()
    if (!supportedExtensions.has(extension)) {
      unsupportedFiles += 1
      continue
    }

    const scriptKind =
      extension === '.tsx' || extension === '.jsx'
        ? ts.ScriptKind.TSX
        : extension === '.js' || extension === '.mjs' || extension === '.cjs'
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS
    const sourceFile = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    )
    const parseDiagnostics = (
      sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
    ).parseDiagnostics
    if (parseDiagnostics.length > 0) {
      malformedFiles += 1
      continue
    }

    const visit = (node: ts.Node): void => {
      if (now() - startedAt > maxDurationMs) {
        throw new QualityAnalysisError('Quality analysis timed out')
      }
      if (isFunctionLike(node) && node.body) {
        const complexity = calculateComplexity(node)
        if (complexity > MAX_FUNCTION_CYCLOMATIC_COMPLEXITY) {
          const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
          const endLine = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1
          const intersectsChangedLines =
            file.changedLines === undefined ||
            file.changedLines.length === 0 ||
            file.changedLines.some((changedLine) => changedLine >= startLine && changedLine <= endLine)
          if (intersectsChangedLines) {
            findings.push(buildFinding(file.path, file.content, node, complexity))
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  const limitations: string[] = []
  if (unsupportedFiles > 0) {
    limitations.push(
      `Deterministic complexity analysis skipped ${unsupportedFiles} unsupported file(s); it currently supports TypeScript and JavaScript.`
    )
  }
  if (malformedFiles > 0) {
    limitations.push(
      `Deterministic complexity analysis skipped ${malformedFiles} file(s) with syntax errors.`
    )
  }
  return { findings, limitations }
}
