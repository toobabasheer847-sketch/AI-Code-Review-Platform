import { Prisma } from '@prisma/client'
import { prisma } from '@/config/database'
import type {
  AttemptCompletion,
  VerificationJobRecord,
  VerificationJobStore,
} from './fix-verification.lifecycle'

const proposalSelection = {
  proposal: { select: { patch: true, findingId: true, userId: true } },
} as const

type StoredAttempt = {
  id: string
  proposalId: string
  requestedById: string
  patchSha256: string
  status: VerificationJobRecord['status']
  executionStatus: VerificationJobRecord['executionStatus']
  jobState: VerificationJobRecord['jobState']
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
  findingTitle: string
  findingSeverity: string
  findingFile: string
  repositoryName: string
  repositoryUrl: string
  branch: string
  pullRequestNumber: number | null
  commitSha: string | null
  changedFiles: string[]
  proposal: { patch: string; findingId: string; userId: string }
}

function mapJob(attempt: StoredAttempt): VerificationJobRecord {
  return {
    id: attempt.id,
    proposalId: attempt.proposalId,
    requestedById: attempt.requestedById,
    patch: attempt.proposal.patch,
    patchSha256: attempt.patchSha256,
    findingId: attempt.proposal.findingId,
    findingTitle: attempt.findingTitle,
    findingSeverity: attempt.findingSeverity,
    findingFile: attempt.findingFile,
    repositoryName: attempt.repositoryName,
    repositoryUrl: attempt.repositoryUrl,
    branch: attempt.branch,
    pullRequestNumber: attempt.pullRequestNumber,
    commitSha: attempt.commitSha,
    changedFiles: attempt.changedFiles,
    status: attempt.status,
    executionStatus: attempt.executionStatus,
    jobState: attempt.jobState,
    executionOccurred: attempt.executionOccurred,
    retryCount: attempt.retryCount,
    cancelRequestedAt: attempt.cancelRequestedAt,
    runnerRunId: attempt.runnerRunId,
    claimedAt: attempt.claimedAt,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    testsPassed: attempt.testsPassed,
    sanitizedLogs: attempt.sanitizedLogs,
    failureDetails: attempt.failureDetails,
  }
}

async function readJob(attemptId: string): Promise<VerificationJobRecord | null> {
  const attempt = await prisma.fixVerificationAttempt.findUnique({
    where: { id: attemptId },
    include: proposalSelection,
  })
  return attempt ? mapJob(attempt) : null
}

export const prismaVerificationJobStore: VerificationJobStore = {
  findJob: readJob,

  async claim(attemptId, claimedAt) {
    const updated = await prisma.fixVerificationAttempt.updateMany({
      where: { id: attemptId, jobState: 'QUEUED', cancelRequestedAt: null },
      data: { jobState: 'RUNNING', claimedAt, executionStatus: 'NOT_RUN' },
    })
    return updated.count === 1
  },

  async markQueuedForRetry(attemptId, retryCount) {
    await prisma.fixVerificationAttempt.updateMany({
      where: {
        id: attemptId,
        jobState: { in: ['QUEUED', 'RUNNING'] },
        cancelRequestedAt: null,
      },
      data: { jobState: 'QUEUED', retryCount, claimedAt: null, runnerRunId: null },
    })
  },

  async markAccepted(attemptId, runId) {
    await prisma.fixVerificationAttempt.updateMany({
      where: { id: attemptId, jobState: 'RUNNING', cancelRequestedAt: null },
      data: { runnerRunId: runId },
    })
  },

  async complete(input: AttemptCompletion) {
    await prisma.fixVerificationAttempt.updateMany({
      where: { id: input.id, jobState: { in: ['QUEUED', 'RUNNING'] } },
      data: {
        status: input.status,
        jobState: input.jobState,
        executionStatus: input.executionStatus,
        executionOccurred: input.executionOccurred,
        testCommands: input.testCommands,
        testsPassed: input.testsPassed,
        originalIssueReproducedBefore: input.originalIssueReproducedBefore,
        originalIssueReproducedAfter: input.originalIssueReproducedAfter,
        checkResults: input.checkResults as unknown as Prisma.InputJsonValue,
        executionDurationMs: input.executionDurationMs,
        exitCode: input.exitCode,
        failureDetails: input.failureDetails,
        completedAt: input.completedAt,
        sanitizedLogs: input.sanitizedLogs,
        runnerIdentity: input.runnerIdentity,
        runnerVersion: input.runnerVersion,
        runnerRunId: input.runnerRunId,
      },
    })
  },

  async cancel(userId, attemptId, at) {
    const attempt = await prisma.fixVerificationAttempt.findFirst({
      where: {
        id: attemptId,
        requestedById: userId,
        proposal: { is: { userId } },
      },
      include: proposalSelection,
    })
    if (!attempt) return null
    if (attempt.jobState !== 'QUEUED' && attempt.jobState !== 'RUNNING') return mapJob(attempt)
    await prisma.fixVerificationAttempt.updateMany({
      where: {
        id: attemptId,
        requestedById: userId,
        jobState: { in: ['QUEUED', 'RUNNING'] },
      },
      data: {
        cancelRequestedAt: at,
        jobState: 'CANCELLED',
        status: 'NEEDS_REVIEW',
        executionStatus: 'NOT_RUN',
        executionOccurred: false,
        testsPassed: null,
        completedAt: at,
        failureDetails: 'Verification was cancelled before a result was accepted.',
        sanitizedLogs: 'Verification was cancelled. Repository output was not accepted as a passing result.',
      },
    })
    return readJob(attemptId)
  },

  async listStaleRunning(olderThan) {
    const attempts = await prisma.fixVerificationAttempt.findMany({
      where: {
        jobState: 'RUNNING',
        OR: [{ claimedAt: { lt: olderThan } }, { claimedAt: null, startedAt: { lt: olderThan } }],
      },
      include: proposalSelection,
      take: 100,
    })
    return attempts.map(mapJob)
  },

  async listQueued() {
    const attempts = await prisma.fixVerificationAttempt.findMany({
      where: { jobState: 'QUEUED', cancelRequestedAt: null },
      select: { id: true },
      take: 100,
    })
    return attempts.map((attempt) => attempt.id)
  },
}

export function cancelOwnedVerification(
  userId: string,
  attemptId: string,
  at = new Date()
): Promise<VerificationJobRecord | null> {
  return prismaVerificationJobStore.cancel(userId, attemptId, at)
}
