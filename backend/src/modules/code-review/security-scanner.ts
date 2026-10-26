import { performance } from 'node:perf_hooks'
import type { ReviewFinding } from './analyzer'
import type { ReviewSourceFile } from '@/modules/github/github.service'

export const MAX_SECURITY_SCAN_FILES = 20
export const MAX_SECURITY_SCAN_FILE_BYTES = 20_000
export const MAX_SECURITY_SCAN_TOTAL_BYTES = 100_000
export const MAX_SECURITY_SCAN_DURATION_MS = 250
export const MAX_SECURITY_SCAN_FINDINGS = 100

const knownCredentialPatterns = [
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,})\b/g,
]

const credentialAssignment =
  /\b(?:api[_-]?key|secret|password|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*(['"])([^'"\r\n]{12,})\1/gi
const placeholderValue = /^(?:\*+|x+|<[^>]+>|\$\{[^}]+\}|your[_ -]|example|sample|dummy|fake|test|changeme|replace[_ -])/i
const placeholderLine = /\b(?:example|sample|dummy|fake|test[_ -]?only|placeholder)\b/i

export class SecurityScanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecurityScanError'
  }
}

export interface SecurityScanOptions {
  now?: () => number
  maxDurationMs?: number
}

function redactCredentials(line: string, credentials: string[]): string {
  return [...new Set(credentials)].reduce(
    (redacted, credential) => redacted.replaceAll(credential, '[REDACTED]'),
    line
  )
}

function createFinding(file: string, line: number, evidence: string): ReviewFinding {
  return {
    file,
    line,
    endLine: line,
    severity: 'error',
    category: 'security',
    title: 'Credential-like value embedded in source',
    message:
      'A high-confidence credential pattern or credential assignment with a literal value was found in source code.',
    impact:
      'If this value is active, it may grant access to an external service or account.',
    evidence,
    suggestions: [
      'Revoke or rotate the exposed credential, remove it from source history, and load the replacement from a managed secret store.',
    ],
    source: 'STATIC_ANALYSIS',
  }
}

function shouldIgnoreCredential(credential: string, line: string): boolean {
  return placeholderValue.test(credential.trim()) || placeholderLine.test(line)
}

function findCredentials(sourceLine: string): string[] {
  const credentials: string[] = []
  for (const pattern of knownCredentialPatterns) {
    pattern.lastIndex = 0
    for (const match of sourceLine.matchAll(pattern)) {
      if (match[0]) credentials.push(match[0])
    }
  }
  credentialAssignment.lastIndex = 0
  for (const match of sourceLine.matchAll(credentialAssignment)) {
    if (match[2]) credentials.push(match[2])
  }
  return credentials
}

export function redactCredentialSource(files: ReviewSourceFile[]): ReviewSourceFile[] {
  return files.map((file) => ({
    ...file,
    content: file.content
      .split(/(\r?\n)/)
      .map((part, index) => {
        if (index % 2 !== 0) return part
        return redactCredentials(
          part,
          findCredentials(part).filter((credential) => !shouldIgnoreCredential(credential, part))
        )
      })
      .join(''),
  }))
}

export function scanCredentialPatterns(
  files: ReviewSourceFile[],
  options: SecurityScanOptions = {}
): ReviewFinding[] {
  const now = options.now ?? performance.now.bind(performance)
  const startedAt = now()
  const maxDurationMs = options.maxDurationMs ?? MAX_SECURITY_SCAN_DURATION_MS
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    throw new SecurityScanError('Invalid security scan time budget')
  }
  if (!Array.isArray(files)) {
    throw new SecurityScanError('Security scan received malformed source data')
  }
  if (files.length > MAX_SECURITY_SCAN_FILES) {
    throw new SecurityScanError('Security scan file limit exceeded')
  }

  let totalBytes = 0
  const findings: ReviewFinding[] = []
  const seen = new Set<string>()

  for (const file of files) {
    if (
      typeof file !== 'object' ||
      file === null ||
      typeof file.path !== 'string' ||
      file.path.length === 0 ||
      typeof file.content !== 'string'
    ) {
      throw new SecurityScanError('Security scan received malformed source data')
    }

    const fileBytes = Buffer.byteLength(file.content, 'utf8')
    if (fileBytes > MAX_SECURITY_SCAN_FILE_BYTES) {
      throw new SecurityScanError('Security scan file size limit exceeded')
    }
    totalBytes += fileBytes
    if (totalBytes > MAX_SECURITY_SCAN_TOTAL_BYTES) {
      throw new SecurityScanError('Security scan total size limit exceeded')
    }

    const lines = file.content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      if (now() - startedAt > maxDurationMs) {
        throw new SecurityScanError('Security scan timed out')
      }
      const sourceLine = lines[index] ?? ''
      const credentials = findCredentials(sourceLine)

      const detectedCredentials = credentials.filter(
        (candidate) => !shouldIgnoreCredential(candidate, sourceLine)
      )
      if (detectedCredentials.length === 0) continue

      const key = `${file.path}\0${index + 1}`
      if (seen.has(key)) continue
      seen.add(key)
      findings.push(createFinding(
        file.path,
        index + 1,
        redactCredentials(sourceLine, detectedCredentials).slice(0, 500)
      ))
      if (findings.length >= MAX_SECURITY_SCAN_FINDINGS) return findings
    }
  }
  return findings
}
