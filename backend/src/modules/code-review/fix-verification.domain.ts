import { createHash } from 'node:crypto'
import { z } from 'zod'

export const MAX_FIX_PATCH_BYTES = 100_000
export const MAX_VERIFICATION_LOG_BYTES = 8_000

export const createFixProposalSchema = z
  .object({
    patch: z.string().min(1).max(MAX_FIX_PATCH_BYTES),
  })
  .strict()

export type FixVerificationStatus = 'RUNNING' | 'VERIFIED' | 'FAILED' | 'INCONCLUSIVE'
export type FixVerificationExecutionStatus =
  | 'NOT_RUN'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'BLOCKED'

export interface VerificationExecutionResult {
  patchSha256: string
  executionStatus: Exclude<FixVerificationExecutionStatus, 'NOT_RUN' | 'BLOCKED'>
  testCommands: string[]
  testsPassed: boolean
  originalIssueReproducedBefore: boolean | null
  originalIssueReproducedAfter: boolean | null
  sanitizedLogs: string
}

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
    !lines.some((line) => (/^\+/.test(line) && !line.startsWith('+++ ')) ||
      (/^-(?!-)/.test(line)))
  ) {
    throw new FixProposalValidationError('Provide a unified diff with file headers and a change hunk.')
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
  result: VerificationExecutionResult
): Exclude<FixVerificationStatus, 'RUNNING'> {
  if (result.patchSha256 !== expectedPatchSha256) return 'INCONCLUSIVE'
  if (result.executionStatus === 'TIMED_OUT') return 'INCONCLUSIVE'
  if (
    result.executionStatus === 'FAILED' ||
    !result.testsPassed ||
    result.originalIssueReproducedAfter === true
  ) {
    return 'FAILED'
  }
  if (
    result.executionStatus === 'SUCCEEDED' &&
    result.testsPassed &&
    result.originalIssueReproducedBefore === true &&
    result.originalIssueReproducedAfter === false
  ) {
    return 'VERIFIED'
  }
  return 'INCONCLUSIVE'
}

export function sanitizeVerificationLogs(logs: string): string {
  const sanitized = logs
    // ANSI escape sequences contain terminal control characters by design.
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]')
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
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
