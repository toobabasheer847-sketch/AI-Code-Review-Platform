import { createHash } from 'node:crypto'
import { z } from 'zod'

export const MAX_FIX_PATCH_BYTES = 100_000
export const MAX_VERIFICATION_LOG_BYTES = 8_000

export const createFixProposalSchema = z
  .object({
    patch: z.string().min(1).max(MAX_FIX_PATCH_BYTES),
  })
  .strict()

export type FixVerificationStatus = 'RUNNING' | 'VERIFIED' | 'FAILED' | 'NEEDS_REVIEW'
export type FixVerificationExecutionStatus =
  | 'NOT_RUN'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'BLOCKED'
export type FixVerificationCheckName = 'TEST' | 'TYPECHECK' | 'LINT'
export type FixVerificationCheckStatus = 'PASSED' | 'FAILED' | 'TIMED_OUT' | 'NOT_RUN'

export interface VerificationCheckResult {
  name: FixVerificationCheckName
  command: string
  status: FixVerificationCheckStatus
  exitCode: number | null
  durationMs: number
  failureDetails: string | null
  logs: string
}

export interface VerificationExecutionResult {
  attemptId: string
  patchSha256: string
  commitSha: string | null
  executionStatus: Exclude<FixVerificationExecutionStatus, 'NOT_RUN' | 'BLOCKED'>
  testCommands: string[]
  testsPassed: boolean
  originalIssueReproducedBefore: boolean | null
  originalIssueReproducedAfter: boolean | null
  sanitizedLogs: string
  checkResults?: VerificationCheckResult[]
  durationMs?: number
  exitCode?: number | null
  failureDetails?: string | null
}

export const verificationCheckResultSchema = z
  .object({
    name: z.enum(['TEST', 'TYPECHECK', 'LINT']),
    command: z.string().max(500),
    status: z.enum(['PASSED', 'FAILED', 'TIMED_OUT', 'NOT_RUN']),
    exitCode: z.number().int().nullable(),
    durationMs: z.number().int().nonnegative(),
    failureDetails: z.string().max(2_000).nullable(),
    logs: z.string().max(MAX_VERIFICATION_LOG_BYTES),
  })
  .strict()

export const verificationExecutionResultSchema = z
  .object({
    attemptId: z.string().min(1).max(128),
    patchSha256: z.string().regex(/^[a-f0-9]{64}$/),
    commitSha: z.string().nullable(),
    executionStatus: z.enum(['SUCCEEDED', 'FAILED', 'TIMED_OUT']),
    testCommands: z.array(z.string().max(20_000)).max(10),
    testsPassed: z.boolean(),
    originalIssueReproducedBefore: z.boolean().nullable(),
    originalIssueReproducedAfter: z.boolean().nullable(),
    sanitizedLogs: z.string().max(100_000),
    checkResults: z.array(verificationCheckResultSchema).max(10),
    durationMs: z.number().int().nonnegative().optional(),
    exitCode: z.number().int().nullable().optional(),
    failureDetails: z.string().max(10_000).nullable().optional(),
  })
  .strict()

export function hashFixPatch(patch: string): string {
  return createHash('sha256').update(patch, 'utf8').digest('hex')
}

export function validateFixPatch(patch: string): void {
  if (Buffer.byteLength(patch, 'utf8') > MAX_FIX_PATCH_BYTES) {
    throw new FixProposalValidationError('Patch must be 100 KB or smaller.')
  }
  if (patch.includes('\0')) {
    throw new FixProposalValidationError('Patch must not contain binary data.')
  }

  const fileHeaders = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith('--- ') || line.startsWith('+++ '))
  const lines = patch.split(/\r?\n/)
  const orderedHeaders = fileHeaders.every((header, index) =>
    index % 2 === 0 ? header.startsWith('--- ') : header.startsWith('+++ ')
  )
  if (
    fileHeaders.length < 2 ||
    fileHeaders.length % 2 !== 0 ||
    !orderedHeaders ||
    !lines.some((line) => line.startsWith('@@')) ||
    !lines.some((line) => (/^\+/.test(line) && !line.startsWith('+++ ')) || /^-(?!-)/.test(line))
  ) {
    throw new FixProposalValidationError(
      'Provide a unified diff with file headers and a change hunk.'
    )
  }

  for (const header of fileHeaders) {
    const rawPath = header.slice(4).split('\t', 1)[0]
    if (!rawPath || rawPath === '/dev/null') continue
    const path = rawPath.replace(/^[ab]\//, '')
    if (
      !path ||
      path.startsWith('/') ||
      path.includes('\\') ||
      /^[A-Za-z]:/.test(path) ||
      path.split('/').some((segment) => segment === '..' || segment === '.git')
    ) {
      throw new FixProposalValidationError('Patch contains an unsafe file path.')
    }
  }
}

export function classifyVerificationResult(
  expectedPatchSha256: string,
  expectedCommitSha: string | null,
  result: VerificationExecutionResult
): Exclude<FixVerificationStatus, 'RUNNING'> {
  if (
    result.patchSha256 !== expectedPatchSha256 ||
    !expectedCommitSha ||
    result.commitSha !== expectedCommitSha
  ) {
    return 'NEEDS_REVIEW'
  }
  if (
    result.executionStatus === 'FAILED' ||
    (result.exitCode !== undefined && result.exitCode !== null && result.exitCode !== 0) ||
    result.checkResults?.some((check) => check.status === 'FAILED') ||
    result.originalIssueReproducedAfter === true
  ) {
    return 'FAILED'
  }
  if (result.executionStatus === 'TIMED_OUT') return 'NEEDS_REVIEW'
  const testCheck = result.checkResults?.find((check) => check.name === 'TEST')
  if (!testCheck) return 'NEEDS_REVIEW'
  if (testCheck.status === 'PASSED' && testCheck.exitCode !== 0) return 'FAILED'
  if (testCheck.status === 'FAILED' || (!result.testsPassed && testCheck.status === 'PASSED')) {
    return 'FAILED'
  }
  if (!result.testsPassed) return 'NEEDS_REVIEW'
  if (
    result.executionStatus === 'SUCCEEDED' &&
    result.testsPassed &&
    result.testCommands.length > 0 &&
    result.testCommands.every((command) => command.trim().length > 0) &&
    result.checkResults !== undefined &&
    result.checkResults.length > 0 &&
    result.checkResults.every(
      (check) =>
        check.status === 'PASSED' &&
        check.exitCode === 0 &&
        check.command.trim().length > 0
    ) &&
    result.originalIssueReproducedBefore === true &&
    result.originalIssueReproducedAfter === false
  ) {
    return 'VERIFIED'
  }
  return 'NEEDS_REVIEW'
}

export function getChangedFilesFromPatch(patch: string): string[] {
  return [
    ...new Set(
      patch
        .split(/\r?\n/)
        .filter((line) => line.startsWith('--- ') || line.startsWith('+++ '))
        .map((line) =>
          line
            .slice(4)
            .split('\t', 1)[0]
            .replace(/^[ab]\//, '')
        )
        .filter((path) => Boolean(path) && path !== '/dev/null')
    ),
  ]
}

export function sanitizeVerificationLogs(logs: string): string {
  const sanitized = logs
    // ANSI escape sequences contain terminal control characters by design.
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]')
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
      '[REDACTED]'
    )
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]'
    )
    // Strip control bytes from untrusted runner output.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  return Buffer.from(sanitized, 'utf8')
    .subarray(0, MAX_VERIFICATION_LOG_BYTES)
    .toString('utf8')
    .replace(/\uFFFD$/, '')
}

export class FixProposalValidationError extends Error {
  readonly statusCode = 400

  constructor(message: string) {
    super(message)
    this.name = 'FixProposalValidationError'
  }
}
