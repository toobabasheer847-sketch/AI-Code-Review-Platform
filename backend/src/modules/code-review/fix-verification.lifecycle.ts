import { z } from 'zod'
import {
  classifyVerificationResult,
  sanitizeVerificationLogs,
  verificationCheckResultSchema,
  verificationExecutionResultSchema,
  type FixVerificationExecutionStatus,
  type FixVerificationStatus,
  type VerificationCheckResult,
  type VerificationExecutionResult,
} from './fix-verification.domain'
import { VerificationRunnerTimeoutError } from './fix-verification.runner'

const MAX_VERIFICATION_CHECKS = 10
const MAX_VERIFICATION_COMMANDS = 10
const MAX_VERIFICATION_COMMAND_BYTES = 500
const MAX_VERIFICATION_LOG_BYTES = 8_000

export type FixVerificationJobState =
  | 'QUEUED'
  | 'RUNNING'
  | 'PASSED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'CANCELLED'
  | 'NEEDS_REVIEW'

export interface VerificationJobDispatcher {
  enqueue(attemptId: string): Promise<void>
}

export class RetryableVerificationDispatchError extends Error {
  constructor() {
    super('The verification runner was unavailable before execution started.')
    this.name = 'RetryableVerificationDispatchError'
  }
}

export interface VerificationJobRecord {
  id: string
  proposalId: string
  requestedById: string
  patch: string
  patchSha256: string
  findingId: string
  findingTitle: string
  findingSeverity: string
  findingFile: string
  repositoryName: string
  repositoryUrl: string
  branch: string
  pullRequestNumber: number | null
  commitSha: string | null
  changedFiles: string[]
  status: FixVerificationStatus
  executionStatus: FixVerificationExecutionStatus
  jobState: FixVerificationJobState
  executionOccurred: boolean
  retryCount: number
  cancelRequestedAt: Date | null
  runnerRunId: string | null
  claimedAt: Date | null
  startedAt: Date
  completedAt: Date | null
  testsPassed: boolean | null
  sanitizedLogs: string | null
  failureDetails: string | null
}

export interface AttemptCompletion {
  id: string
  status: Exclude<FixVerificationStatus, 'RUNNING'>
  jobState: FixVerificationJobState
  executionStatus: FixVerificationExecutionStatus
  executionOccurred: boolean
  testCommands: string[]
  testsPassed: boolean | null
  originalIssueReproducedBefore: boolean | null
  originalIssueReproducedAfter: boolean | null
  checkResults: VerificationCheckResult[]
  executionDurationMs: number
  exitCode: number | null
  failureDetails: string | null
  completedAt: Date
  sanitizedLogs: string
  runnerIdentity: string | null
  runnerVersion: string | null
  runnerRunId: string | null
}

export interface VerificationJobStore {
  findJob(attemptId: string): Promise<VerificationJobRecord | null>
  claim(attemptId: string, claimedAt: Date): Promise<boolean>
  markQueuedForRetry(attemptId: string, retryCount: number): Promise<void>
  markAccepted(attemptId: string, runId: string): Promise<void>
  complete(input: AttemptCompletion): Promise<void>
  cancel(userId: string, attemptId: string, at: Date): Promise<VerificationJobRecord | null>
  listStaleRunning(olderThan: Date): Promise<VerificationJobRecord[]>
  listQueued(): Promise<string[]>
}

export interface VerificationDispatchRunner {
  dispatch(input: {
    attemptId: string
    proposalId: string
    patch: string
    patchSha256: string
    repository: {
      name: string
      url: string
      branch: string
      pullRequestNumber: number | null
      commitSha: string | null
    }
    finding: { id: string; title: string; severity: string; file: string }
    changedFiles: string[]
  }): Promise<
    | { kind: 'accepted'; runId: string }
    | { kind: 'completed'; result: VerificationExecutionResult }
  >
  poll(
    attemptId: string
  ): Promise<
    | { kind: 'pending' }
    | { kind: 'missing' }
    | { kind: 'completed'; result: VerificationExecutionResult }
  >
}

export type VerificationJobOutcome =
  | { kind: 'completed'; jobState: FixVerificationJobState }
  | { kind: 'pending' }
  | { kind: 'retry' }
  | { kind: 'missing' }

const checkResultsSchema = z.array(verificationCheckResultSchema).max(MAX_VERIFICATION_CHECKS)

export function jobStateForStatus(
  status: Exclude<FixVerificationStatus, 'RUNNING'>,
  executionStatus: FixVerificationExecutionStatus
): FixVerificationJobState {
  if (status === 'VERIFIED') return 'PASSED'
  if (status === 'FAILED') return 'FAILED'
  if (executionStatus === 'TIMED_OUT') return 'TIMED_OUT'
  return 'NEEDS_REVIEW'
}

export function isTerminalJobState(jobState: FixVerificationJobState): boolean {
  return jobState !== 'QUEUED' && jobState !== 'RUNNING'
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.length <= maximumBytes) return value
  return buffer.subarray(0, maximumBytes).toString('utf8').replace(/\uFFFD$/, '')
}

function executionDidOccur(result: VerificationExecutionResult | null): boolean {
  if (!result || result.executionOccurred === false) return false
  if (result.executionOccurred === true) return true
  return result.executionStatus === 'SUCCEEDED' || result.executionStatus === 'FAILED'
}

export function buildAttemptCompletion(input: {
  attemptId: string
  expectedPatchSha256: string
  expectedCommitSha: string | null
  result: VerificationExecutionResult | null
  runnerConfigured: boolean
  runnerFailure?: unknown
  startedAt: Date
  completedAt: Date
  cancelled?: boolean
  queueFailure?: boolean
  runnerRunId?: string | null
}): AttemptCompletion {
  const result = input.result
  const reportedChecks = result?.checkResults ?? []
  const storedChecks = reportedChecks.slice(0, MAX_VERIFICATION_CHECKS)
  const validChecks = checkResultsSchema.safeParse(storedChecks)
  let remainingCheckLogBytes = MAX_VERIFICATION_LOG_BYTES
  const checkResults = (validChecks.success ? validChecks.data : []).map((check) => {
    const logs = truncateUtf8(sanitizeVerificationLogs(check.logs), remainingCheckLogBytes)
    remainingCheckLogBytes -= Buffer.byteLength(logs, 'utf8')
    return {
      ...check,
      command: truncateUtf8(sanitizeVerificationLogs(check.command), MAX_VERIFICATION_COMMAND_BYTES),
      logs,
      failureDetails: check.failureDetails
        ? sanitizeVerificationLogs(check.failureDetails).slice(0, 2_000)
        : null,
    }
  })
  const malformed = Boolean(
    result &&
      (result.attemptId !== input.attemptId ||
        reportedChecks.length > MAX_VERIFICATION_CHECKS ||
        !validChecks.success ||
        result.testCommands.length > MAX_VERIFICATION_COMMANDS ||
        result.testCommands.some((command) => command.length > 20_000))
  )
  const runnerTimedOut = input.runnerFailure instanceof VerificationRunnerTimeoutError
  const executionOccurred = malformed ? false : executionDidOccur(result)
  let status: Exclude<FixVerificationStatus, 'RUNNING'> = 'NEEDS_REVIEW'
  if (result && !malformed) {
    status = classifyVerificationResult(
      input.expectedPatchSha256,
      input.expectedCommitSha,
      result
    )
  }
  if (!executionOccurred && status === 'VERIFIED') status = 'NEEDS_REVIEW'
  const executionStatus: FixVerificationExecutionStatus = !result
    ? runnerTimedOut
      ? 'TIMED_OUT'
      : 'BLOCKED'
    : malformed
      ? 'BLOCKED'
      : result.executionStatus
  const jobState: FixVerificationJobState = input.cancelled
    ? 'CANCELLED'
    : jobStateForStatus(input.cancelled ? 'NEEDS_REVIEW' : status, executionStatus)
  const completedAt = result?.completedAt ? new Date(result.completedAt) : input.completedAt
  const durationFromResult = result?.durationMs
  const durationMs =
    durationFromResult ??
    Math.max(0, (Number.isNaN(completedAt.getTime()) ? input.completedAt : completedAt).getTime() - input.startedAt.getTime())
  const failureDetails = input.cancelled
    ? 'Verification was cancelled. The result was not accepted.'
    : input.queueFailure
      ? 'The verification job could not be queued; no repository code was executed.'
    : !result
      ? input.runnerConfigured
        ? runnerTimedOut
          ? 'The isolated verification runner exceeded its configured timeout; no verification result was accepted.'
          : 'The isolated verification runner did not return valid evidence; no verification result was accepted.'
        : 'No isolated verification runner is configured; no repository code was executed.'
      : malformed
        ? 'The isolated verification runner returned malformed evidence; no verification result was accepted.'
        : result.failureDetails
          ? sanitizeVerificationLogs(result.failureDetails).slice(0, 2_000)
          : null
  const sanitizedLogs = sanitizeVerificationLogs(
    input.cancelled
      ? 'Verification was cancelled. Repository output was not accepted as a passing result.'
      : input.queueFailure
        ? 'The verification job could not be queued. The patch was not executed.'
      : !result
        ? input.runnerConfigured
          ? runnerTimedOut
            ? 'The isolated verification runner timed out; the outcome is inconclusive.'
            : `The isolated verification runner did not return valid evidence (${input.runnerFailure instanceof Error ? input.runnerFailure.name : 'unknown error'}); outcome is inconclusive.`
          : 'No isolated verification runner is configured; the patch was not executed.'
        : result.sanitizedLogs
  )
  return {
    id: input.attemptId,
    status: input.cancelled ? 'NEEDS_REVIEW' : status,
    jobState,
    executionStatus: input.cancelled ? 'NOT_RUN' : executionStatus,
    executionOccurred: input.cancelled ? false : executionOccurred,
    testCommands: (result?.testCommands ?? [])
      .slice(0, MAX_VERIFICATION_COMMANDS)
      .filter((command) => typeof command === 'string')
      .map((command) => truncateUtf8(sanitizeVerificationLogs(command), MAX_VERIFICATION_COMMAND_BYTES)),
    testsPassed: input.cancelled || !executionOccurred ? null : (result?.testsPassed ?? null),
    originalIssueReproducedBefore:
      input.cancelled || !executionOccurred ? null : (result?.originalIssueReproducedBefore ?? null),
    originalIssueReproducedAfter:
      input.cancelled || !executionOccurred ? null : (result?.originalIssueReproducedAfter ?? null),
    checkResults: input.cancelled || malformed ? [] : checkResults,
    executionDurationMs: Math.max(0, Number.isFinite(durationMs) ? Math.floor(durationMs) : 0),
    exitCode: input.cancelled || !result ? null : (result.exitCode ?? null),
    failureDetails,
    completedAt: Number.isNaN(completedAt.getTime()) ? input.completedAt : completedAt,
    sanitizedLogs,
    runnerIdentity: result?.runnerIdentity ?? null,
    runnerVersion: result?.runnerVersion ?? null,
    runnerRunId: input.runnerRunId ?? null,
  }
}

function runnerInput(job: VerificationJobRecord) {
  return {
    attemptId: job.id,
    proposalId: job.proposalId,
    patch: job.patch,
    patchSha256: job.patchSha256,
    repository: {
      name: job.repositoryName,
      url: job.repositoryUrl,
      branch: job.branch,
      pullRequestNumber: job.pullRequestNumber,
      commitSha: job.commitSha,
    },
    finding: {
      id: job.findingId,
      title: job.findingTitle,
      severity: job.findingSeverity,
      file: job.findingFile,
    },
    changedFiles: job.changedFiles,
  }
}

async function finish(
  store: VerificationJobStore,
  job: VerificationJobRecord,
  input: Omit<Parameters<typeof buildAttemptCompletion>[0], 'attemptId' | 'expectedPatchSha256' | 'expectedCommitSha' | 'startedAt'> & {
    startedAt?: Date
  }
): Promise<VerificationJobOutcome> {
  const completion = buildAttemptCompletion({
    attemptId: job.id,
    expectedPatchSha256: job.patchSha256,
    expectedCommitSha: job.commitSha,
    startedAt: input.startedAt ?? job.startedAt,
    runnerRunId: input.runnerRunId ?? job.runnerRunId,
    ...input,
  })
  await store.complete(completion)
  return { kind: 'completed', jobState: completion.jobState }
}

export async function processVerificationJob(
  store: VerificationJobStore,
  runner: VerificationDispatchRunner,
  attemptId: string,
  options: { now?: Date; maxDispatchAttempts?: number } = {}
): Promise<VerificationJobOutcome> {
  const now = options.now ?? new Date()
  const maxDispatchAttempts = options.maxDispatchAttempts ?? 3
  const job = await store.findJob(attemptId)
  if (!job) return { kind: 'missing' }
  if (isTerminalJobState(job.jobState)) return { kind: 'completed', jobState: job.jobState }
  if (job.cancelRequestedAt) {
    return finish(store, job, {
      result: null,
      runnerConfigured: true,
      completedAt: now,
      cancelled: true,
    })
  }
  if (job.jobState === 'QUEUED') {
    const claimed = await store.claim(attemptId, now)
    if (!claimed) {
      const current = await store.findJob(attemptId)
      if (!current || isTerminalJobState(current.jobState)) {
        return { kind: 'completed', jobState: current?.jobState ?? 'NEEDS_REVIEW' }
      }
      return { kind: 'pending' }
    }
  } else if (job.runnerRunId) {
    const polled = await runner.poll(attemptId)
    if (polled.kind === 'pending' || polled.kind === 'missing') return { kind: 'pending' }
    return finish(store, job, {
      result: polled.result,
      runnerConfigured: true,
      completedAt: now,
    })
  }

  try {
    const dispatched = await runner.dispatch(runnerInput(job))
    if (dispatched.kind === 'accepted') {
      await store.markAccepted(attemptId, dispatched.runId)
      return { kind: 'pending' }
    }
    const parsed = verificationExecutionResultSchema.safeParse(dispatched.result)
    return finish(store, job, {
      result: parsed.success ? parsed.data : null,
      runnerConfigured: true,
      completedAt: now,
      runnerFailure: parsed.success ? undefined : new Error('malformed'),
    })
  } catch (error) {
    if (error instanceof VerificationRunnerTimeoutError) {
      return finish(store, job, {
        result: null,
        runnerConfigured: true,
        runnerFailure: error,
        completedAt: now,
      })
    }
    const current = await store.findJob(attemptId)
    const retryCount = current?.retryCount ?? job.retryCount
    if (retryCount + 1 < maxDispatchAttempts && !current?.runnerRunId) {
      await store.markQueuedForRetry(attemptId, retryCount + 1)
      return { kind: 'retry' }
    }
    return finish(store, job, {
      result: null,
      runnerConfigured: true,
      runnerFailure: error,
      completedAt: now,
    })
  }
}

export async function applyVerificationCallback(
  store: VerificationJobStore,
  attemptId: string,
  payload: unknown,
  now = new Date()
): Promise<VerificationJobOutcome> {
  const job = await store.findJob(attemptId)
  if (!job) return { kind: 'missing' }
  if (isTerminalJobState(job.jobState)) return { kind: 'completed', jobState: job.jobState }
  if (job.cancelRequestedAt) {
    return finish(store, job, {
      result: null,
      runnerConfigured: true,
      completedAt: now,
      cancelled: true,
    })
  }
  const parsed = verificationExecutionResultSchema.safeParse(payload)
  return finish(store, job, {
    result: parsed.success ? parsed.data : null,
    runnerConfigured: true,
    completedAt: now,
    runnerFailure: parsed.success ? undefined : new Error('malformed'),
  })
}

export async function reconcileStaleVerificationJobs(
  store: VerificationJobStore,
  runner: Pick<VerificationDispatchRunner, 'poll'>,
  now: Date,
  staleAfterMs: number
): Promise<number> {
  const stale = await store.listStaleRunning(new Date(now.getTime() - staleAfterMs))
  let reconciled = 0
  for (const job of stale) {
    if (isTerminalJobState(job.jobState)) continue
    let polled: Awaited<ReturnType<VerificationDispatchRunner['poll']>> = { kind: 'missing' }
    try {
      polled = await runner.poll(job.id)
    } catch {
      polled = { kind: 'missing' }
    }
    if (polled.kind === 'completed') {
      await finish(store, job, {
        result: polled.result,
        runnerConfigured: true,
        completedAt: now,
      })
    } else {
      await finish(store, job, {
        result: null,
        runnerConfigured: true,
        runnerFailure: new Error('interrupted'),
        completedAt: now,
      })
    }
    reconciled += 1
  }
  return reconciled
}
