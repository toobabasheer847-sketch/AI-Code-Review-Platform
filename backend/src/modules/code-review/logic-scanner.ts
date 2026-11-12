import { performance } from 'node:perf_hooks'
import ts from 'typescript'

import type { ReviewFinding } from './analyzer'
import { stampMeasuredFinding } from './review-intelligence'
import {
  MAX_SECURITY_SCAN_FILE_BYTES,
  MAX_SECURITY_SCAN_FILES,
  MAX_SECURITY_SCAN_TOTAL_BYTES,
} from './security-scanner'
import type { ReviewSourceFile } from '@/modules/github/github.service'

export const MAX_LOGIC_SCAN_DURATION_MS = 1_000

const supportedExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])

export interface LogicScanResult {
  findings: ReviewFinding[]
  limitations: string[]
}

function isDiscardedExpression(expression: ts.Expression | undefined): boolean {
  if (!expression) return true
  return (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.UndefinedKeyword ||
    (ts.isIdentifier(expression) && expression.text === 'undefined')
  )
}

function isSwallowedCatch(node: ts.CatchClause): boolean {
  const statements = node.block.statements
  if (statements.length === 0) return true
  if (statements.length !== 1) return false
  const statement = statements[0]
  return statement !== undefined && ts.isReturnStatement(statement) && isDiscardedExpression(statement.expression)
}

function evidenceLine(content: string, line: number): string {
  return (content.split(/\r?\n/)[line - 1] ?? '').trim().slice(0, 500)
}

export function scanLogicPatterns(
  files: ReviewSourceFile[],
  options: { now?: () => number; maxDurationMs?: number } = {}
): LogicScanResult {
  if (!Array.isArray(files)) {
    return { findings: [], limitations: ['Deterministic logic checks skipped malformed source data.'] }
  }
  const now = options.now ?? performance.now.bind(performance)
  const startedAt = now()
  const maxDurationMs = options.maxDurationMs ?? MAX_LOGIC_SCAN_DURATION_MS
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    return { findings: [], limitations: ['Deterministic logic checks skipped because the time budget was invalid.'] }
  }

  const findings: ReviewFinding[] = []
  const limitations: string[] = []
  let totalBytes = 0
  const filesToScan = files.slice(0, MAX_SECURITY_SCAN_FILES)
  if (files.length > MAX_SECURITY_SCAN_FILES) {
    limitations.push('Deterministic logic checks skipped files beyond the static-analysis file limit.')
  }

  for (const file of filesToScan) {
    if (now() - startedAt > maxDurationMs) {
      limitations.push('Deterministic logic checks stopped after the time budget was reached.')
      break
    }
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') continue
    const extension = file.path.slice(file.path.lastIndexOf('.')).toLowerCase()
    if (!supportedExtensions.has(extension)) continue
    const size = Buffer.byteLength(file.content, 'utf8')
    if (size > MAX_SECURITY_SCAN_FILE_BYTES) continue
    totalBytes += size
    if (totalBytes > MAX_SECURITY_SCAN_TOTAL_BYTES) {
      limitations.push('Deterministic logic checks stopped after the source size budget was reached.')
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
    if (parseDiagnostics && parseDiagnostics.length > 0) continue

    const visit = (node: ts.Node): void => {
      if (ts.isCatchClause(node) && isSwallowedCatch(node) && node.block.statements[0]) {
        const statement = node.block.statements[0] ?? node
        const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1
        const evidence = evidenceLine(file.content, line)
        const intersectsChangedLines =
          file.changedLines === undefined ||
          file.changedLines.length === 0 ||
          file.changedLines.includes(line)
        if (evidence.length >= 3 && intersectsChangedLines) {
          findings.push(
            stampMeasuredFinding(
              {
                file: file.path,
                line,
                endLine: line,
                severity: 'warning',
                category: 'bug',
                title: 'Caught error is discarded',
                message: 'The catch block returns without reporting or using the caught error.',
                impact:
                  'A failure can look like a normal empty result, so callers cannot tell that the operation failed.',
                evidence,
                suggestions: [
                  'Log or rethrow the error, or return a typed failure the caller can distinguish from success.',
                ],
                source: 'STATIC_ANALYSIS',
              },
              { confidence: 0.88, riskLevel: 'medium', issueClass: 'error_handling' }
            )
          )
        }
      } else if (ts.isCatchClause(node) && isSwallowedCatch(node) && node.block.statements.length === 0) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
        const evidence = evidenceLine(file.content, line)
        const intersectsChangedLines =
          file.changedLines === undefined ||
          file.changedLines.length === 0 ||
          file.changedLines.includes(line)
        if (evidence.length >= 3 && intersectsChangedLines) {
          findings.push(
            stampMeasuredFinding(
              {
                file: file.path,
                line,
                endLine: line,
                severity: 'warning',
                category: 'bug',
                title: 'Caught error is discarded',
                message: 'The catch block is empty, so the caught error is ignored.',
                impact: 'A failure can disappear, leaving callers with no signal that the operation failed.',
                evidence,
                suggestions: ['Handle the error, log it, or rethrow it.'],
                source: 'STATIC_ANALYSIS',
              },
              { confidence: 0.88, riskLevel: 'medium', issueClass: 'error_handling' }
            )
          )
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return { findings, limitations }
}
