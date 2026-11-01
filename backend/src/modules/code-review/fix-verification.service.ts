import { Prisma } from '@prisma/client'
import { prisma } from '@/config/database'
import {
  createFixProposalSchema,
  FixProposalValidationError,
  getChangedFilesFromPatch,
  hashFixPatch,
  validateFixPatch,
  verificationCheckResultSchema,
  type VerificationExecutionResult,
  type VerificationCheckResult,
  type FixVerificationStatus,
} from './fix-verification.domain'
import {
  buildAttemptCompletion,
  type FixVerificationJobState,
  type VerificationJobDispatcher,
} from './fix-verification.lifecycle'
import {
  fixVerificationQueueDispatcher,
} from '@/jobs/fix-verification.queue'
import { getConfiguredFixVerificationRunner } from './fix-verification.runner'
import { z } from 'zod'

export const MAX_FIX_PROPOSALS_PER_FINDING = 10
export const MAX_VERIFICATION_ATTEMPTS_PER_PROPOSAL = 5
export const MAX_VERIFICATION_DASHBOARD_RUNS = 100
export const MAX_VERIFICATION_CHECKS = 10
export const MAX_VERIFICATION_COMMANDS = 10

export const verificationDashboardFilterSchema = z
  .object({
    status: z.enum(['RUNNING', 'VERIFIED', 'FAILED', 'NEEDS_REVIEW']).optional(),
    repositoryId: z.string().min(1).max(128).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict()
  .refine(
    (filters) => !filters.from || !filters.to || filters.from <= filters.to,
    'The start date must be before the end date.'
  )

export const submitHumanReviewSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'NEEDS_MORE_EVIDENCE']),
    note: z.string().max(1_000).optional(),
  })
  .strict()

export type FixVerificationReviewDecision = z.infer<typeof submitHumanReviewSchema>['decision']

const verificationCheckResultsSchema = z
  .array(verificationCheckResultSchema)
  .max(MAX_VERIFICATION_CHECKS)
const verificationCommandsSchema = z.array(z.string().max(20_000)).max(MAX_VERIFICATION_COMMANDS)

type VerificationSnapshot = {
  findingTitle: string
  findingSeverity: string
  findingFile: string
  repositoryName: string
  repositoryUrl: string
  branch: string
  pullRequestNumber: number | null
  commitSha: string | null
  changedFiles: string[]
}

export interface FixVerificationDashboardRun {
  id: string
  reviewId: string
  findingId: string
  findingTitle: string
  findingSeverity: string
  findingFile: string
  repositoryId: string
  repositoryName: string
  repositoryUrl: string
  branch: string
  pullRequestNumber: number | null
  commitSha: string | null
  changedFiles: string[]
  patchSha256: string
  status: FixVerificationStatus
  executionStatus: string
  testCommands: string[]
  checkResults: VerificationCheckResult[]
  testsPassed: boolean | null
  executionDurationMs: number
  exitCode: number | null
  failureDetails: string | null
  humanReviewDecision: FixVerificationReviewDecision | null
  humanReviewNote: string | null
  humanReviewedAt: Date | null
  startedAt: Date
  completedAt: Date | null
  sanitizedLogs: string | null
  jobState?: FixVerificationJobState
  executionOccurred?: boolean
  runnerIdentity?: string | null
  runnerVersion?: string | null
  retryCount?: number
  runnerRunId?: string | null
}

export interface FixVerificationDashboard {
  total: number
  verified: number
  failed: number
  needsReview: number
  repositories: Array<{ id: string; name: string }>
  runs: FixVerificationDashboardRun[]
}

export class FixProposalNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Finding not found')
    this.name = 'FixProposalNotFoundError'
  }
}

export class FixProposalLimitError extends Error {
  readonly statusCode = 409

  constructor() {
    super('This finding already has the maximum number of fix proposals.')
    this.name = 'FixProposalLimitError'
  }
}

export class FixVerificationLimitError extends Error {
  readonly statusCode = 409

  constructor() {
    super('This patch proposal already has the maximum number of verification attempts.')
    this.name = 'FixVerificationLimitError'
  }
}

export class FixVerificationRevisionConflictError extends Error {
  readonly statusCode = 409

  constructor() {
    super('The source commit changed. Start a new verification request for the updated revision.')
    this.name = 'FixVerificationRevisionConflictError'
  }
}

export interface FixProposalStore {
  findOwnedFinding(userId: string, findingId: string): Promise<{ id: string } | null>
  findProposal(findingId: string, patchSha256: string): Promise<FixProposalRecord | null>
  createProposal(input: {
    userId: string
    findingId: string
    patch: string
    patchSha256: string
  }): Promise<FixProposalRecord>
}

export interface FixProposalRecord {
  id: string
  findingId: string
  userId: string
  patch: string
  patchSha256: string
  createdAt: Date
  attempts: Array<{
    id: string
    requestKey: string
    patchSha256: string
    status: FixVerificationStatus
    executionStatus: 'NOT_RUN' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'BLOCKED'
    testCommands: unknown
    testsPassed: boolean | null
    originalIssueReproducedBefore: boolean | null
    originalIssueReproducedAfter: boolean | null
    repositoryName: string
    repositoryUrl: string
    branch: string
    pullRequestNumber: number | null
    commitSha: string | null
    findingTitle: string
    findingSeverity: string
    findingFile: string
    changedFiles: string[]
    checkResults: Prisma.JsonValue
    executionDurationMs: number
    exitCode: number | null
    failureDetails: string | null
    humanReviewDecision: FixVerificationReviewDecision | null
    humanReviewNote: string | null
    humanReviewedAt: Date | null
    humanReviewerId: string | null
    startedAt: Date
    completedAt: Date | null
    sanitizedLogs: string | null
    createdAt: Date
    jobState?: FixVerificationJobState
    executionOccurred?: boolean
    runnerIdentity?: string | null
    runnerVersion?: string | null
    retryCount?: number
    cancelRequestedAt?: Date | null
    runnerRunId?: string | null
    claimedAt?: Date | null
  }>
}

const prismaFixProposalStore: FixProposalStore = {
  async findOwnedFinding(userId, findingId) {
    return prisma.finding.findFirst({
      where: { id: findingId, review: { is: { userId } } },
      select: { id: true },
    })
  },

  async findProposal(findingId, patchSha256) {
    return prisma.fixProposal.findUnique({
      where: { findingId_patchSha256: { findingId, patchSha256 } },
      include: { attempts: { orderBy: { createdAt: 'desc' } } },
    })
  },

  async createProposal(input) {
    return prisma.$transaction(
      async (transaction) => {
        const existing = await transaction.fixProposal.findUnique({
          where: {
            findingId_patchSha256: {
              findingId: input.findingId,
              patchSha256: input.patchSha256,
            },
          },
          include: { attempts: { orderBy: { createdAt: 'desc' } } },
        })
        if (existing) return existing

        const count = await transaction.fixProposal.count({
          where: { findingId: input.findingId },
        })
        if (count >= MAX_FIX_PROPOSALS_PER_FINDING) throw new FixProposalLimitError()
        return transaction.fixProposal.create({
          data: input,
          include: { attempts: { orderBy: { createdAt: 'desc' } } },
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  },
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function parseVerificationCheckResults(value: Prisma.JsonValue): VerificationCheckResult[] {
  const parsed = verificationCheckResultsSchema.safeParse(value)
  if (!parsed.success) throw new Error('Stored verification check evidence is malformed.')
  return parsed.data
}

function parseVerificationCommands(value: Prisma.JsonValue): string[] {
  const parsed = verificationCommandsSchema.safeParse(value)
  if (!parsed.success) throw new Error('Stored verification commands are malformed.')
  return parsed.data
}

export class FixProposalService {
  constructor(private readonly store: FixProposalStore = prismaFixProposalStore) {}

  async createProposal(
    userId: string,
    findingId: string,
    input: unknown
  ): Promise<FixProposalRecord> {
    const parsed = createFixProposalSchema.safeParse(input)
    if (!parsed.success) {
      throw new FixProposalValidationError('Provide a patch proposal no larger than 100 KB.')
    }
    validateFixPatch(parsed.data.patch)

    const finding = await this.store.findOwnedFinding(userId, findingId)
    if (!finding) throw new FixProposalNotFoundError()

    const patchSha256 = hashFixPatch(parsed.data.patch)
    const existing = await this.store.findProposal(findingId, patchSha256)
    if (existing) return existing

    try {
      return await this.store.createProposal({
        userId,
        findingId,
        patch: parsed.data.patch,
        patchSha256,
      })
    } catch (error) {
      if (!isUniqueConstraintError(error) && !(error instanceof FixProposalLimitError)) {
        throw error
      }
      const duplicate = await this.store.findProposal(findingId, patchSha256)
      if (duplicate) return duplicate
      throw error
    }
  }
}

export interface TrustedVerificationStore {
  findOwnedProposal(
    userId: string,
    proposalId: string
  ): Promise<{
    id: string
    findingId: string
    patchSha256: string
    patch: string
    findingTitle: string
    findingSeverity: string
    findingFile: string
    repositoryName: string
    repositoryUrl: string
    branch: string
    pullRequestNumber: number | null
    commitSha: string | null
  } | null>
  findAttempt(
    proposalId: string,
    requestKey: string
  ): Promise<FixProposalRecord['attempts'][number] | null>
  createAttempt(input: {
    proposalId: string
    requestedById: string
    requestKey: string
    patchSha256: string
    snapshot: VerificationSnapshot
    startedAt: Date
  }): Promise<FixProposalRecord['attempts'][number]>
  completeAttempt(input: {
    id: string
    status: Exclude<FixVerificationStatus, 'RUNNING'>
    executionStatus: 'NOT_RUN' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'BLOCKED'
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
    jobState?: FixVerificationJobState
    executionOccurred?: boolean
    runnerIdentity?: string | null
    runnerVersion?: string | null
    runnerRunId?: string | null
  }): Promise<FixProposalRecord['attempts'][number]>
}

const prismaTrustedVerificationStore: TrustedVerificationStore = {
  async findOwnedProposal(userId, proposalId) {
    const proposal = await prisma.fixProposal.findFirst({
      where: { id: proposalId, userId, finding: { review: { is: { userId } } } },
      select: {
        id: true,
        findingId: true,
        patchSha256: true,
        patch: true,
        finding: {
          select: {
            title: true,
            message: true,
            severity: true,
            file: true,
            review: {
              select: {
                branch: true,
                sourceRevision: true,
                pullRequestNumber: true,
                repository: { select: { name: true, url: true } },
              },
            },
          },
        },
      },
    })
    if (!proposal) return null
    return {
      id: proposal.id,
      findingId: proposal.findingId,
      patchSha256: proposal.patchSha256,
      patch: proposal.patch,
      findingTitle: proposal.finding.title ?? proposal.finding.message,
      findingSeverity: proposal.finding.severity,
      findingFile: proposal.finding.file,
      repositoryName: proposal.finding.review.repository.name,
      repositoryUrl: proposal.finding.review.repository.url,
      branch: proposal.finding.review.branch,
      pullRequestNumber: proposal.finding.review.pullRequestNumber,
      commitSha: proposal.finding.review.sourceRevision,
    }
  },

  async findAttempt(proposalId, requestKey) {
    return prisma.fixVerificationAttempt.findUnique({
      where: { proposalId_requestKey: { proposalId, requestKey } },
    })
  },

  async createAttempt(input) {
    return prisma.$transaction(
      async (transaction) => {
        const count = await transaction.fixVerificationAttempt.count({
          where: { proposalId: input.proposalId },
        })
        if (count >= MAX_VERIFICATION_ATTEMPTS_PER_PROPOSAL) {
          throw new FixVerificationLimitError()
        }
        const { snapshot, ...attemptInput } = input
        return transaction.fixVerificationAttempt.create({
          data: {
            ...attemptInput,
            ...snapshot,
            status: 'RUNNING',
            executionStatus: 'NOT_RUN',
            jobState: 'QUEUED',
            executionOccurred: false,
            testCommands: [],
            checkResults: [],
          },
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  },

  async completeAttempt(input) {
    return prisma.fixVerificationAttempt.update({
      where: { id: input.id },
      data: {
        status: input.status,
        executionStatus: input.executionStatus,
        testCommands: input.testCommands,
        testsPassed: input.testsPassed,
        originalIssueReproducedBefore: input.originalIssueReproducedBefore,
        originalIssueReproducedAfter: input.originalIssueReproducedAfter,
        checkResults: input.checkResults.map((check) => ({
          name: check.name,
          command: check.command,
          status: check.status,
          exitCode: check.exitCode,
          durationMs: check.durationMs,
          failureDetails: check.failureDetails,
          logs: check.logs,
        })),
        executionDurationMs: input.executionDurationMs,
        exitCode: input.exitCode,
        failureDetails: input.failureDetails,
        completedAt: input.completedAt,
        sanitizedLogs: input.sanitizedLogs,
        jobState: input.jobState ?? 'NEEDS_REVIEW',
        executionOccurred: input.executionOccurred ?? false,
        runnerIdentity: input.runnerIdentity ?? null,
        runnerVersion: input.runnerVersion ?? null,
        runnerRunId: input.runnerRunId ?? null,
      },
    })
  },
}

export interface TrustedVerificationRunner {
  execute(input: {
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
    finding: {
      id: string
      title: string
      severity: string
      file: string
    }
    changedFiles: string[]
  }): Promise<VerificationExecutionResult>
}

export class FixVerificationService {
  private readonly runner: TrustedVerificationRunner | null
  private readonly dispatcher: VerificationJobDispatcher | null

  constructor(
    private readonly store: TrustedVerificationStore = prismaTrustedVerificationStore,
    runner?: TrustedVerificationRunner | null,
    private readonly now: () => Date = () => new Date(),
    dispatcher?: VerificationJobDispatcher | null
  ) {
    this.runner = runner === undefined ? getConfiguredFixVerificationRunner() : runner
    this.dispatcher =
      dispatcher !== undefined
        ? dispatcher
        : runner === undefined && this.runner
          ? fixVerificationQueueDispatcher
          : null
  }

  async verifyProposal(
    userId: string,
    proposalId: string,
    requestKey: string
  ): Promise<FixProposalRecord['attempts'][number]> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestKey)) {
      throw new FixProposalValidationError('Invalid verification request key.')
    }
    const proposal = await this.store.findOwnedProposal(userId, proposalId)
    if (!proposal) throw new FixProposalNotFoundError()

    const previous = await this.store.findAttempt(proposalId, requestKey)
    if (previous) {
      if (previous.commitSha !== proposal.commitSha) {
        throw new FixVerificationRevisionConflictError()
      }
      return previous
    }

    const startedAt = this.now()
    let attempt: FixProposalRecord['attempts'][number]
    try {
      attempt = await this.store.createAttempt({
        proposalId,
        requestedById: userId,
        requestKey,
        patchSha256: proposal.patchSha256,
        snapshot: {
          findingTitle: proposal.findingTitle,
          findingSeverity: proposal.findingSeverity,
          findingFile: proposal.findingFile,
          repositoryName: proposal.repositoryName,
          repositoryUrl: proposal.repositoryUrl,
          branch: proposal.branch,
          pullRequestNumber: proposal.pullRequestNumber,
          commitSha: proposal.commitSha,
          changedFiles: getChangedFilesFromPatch(proposal.patch),
        },
        startedAt,
      })
    } catch (error) {
      if (!isUniqueConstraintError(error) && !(error instanceof FixVerificationLimitError)) {
        throw error
      }
      const duplicate = await this.store.findAttempt(proposalId, requestKey)
      if (duplicate) return duplicate
      throw error
    }

    if (this.dispatcher) {
      try {
        await this.dispatcher.enqueue(attempt.id)
        return attempt
      } catch {
        return this.store.completeAttempt(
          buildAttemptCompletion({
            attemptId: attempt.id,
            expectedPatchSha256: proposal.patchSha256,
            expectedCommitSha: proposal.commitSha,
            result: null,
            runnerConfigured: true,
            queueFailure: true,
            startedAt,
            completedAt: this.now(),
          })
        )
      }
    }

    let result: VerificationExecutionResult | null = null
    let runnerFailure: unknown
    if (this.runner) {
      try {
        result = await this.runner.execute({
          attemptId: attempt.id,
          proposalId,
          patch: proposal.patch,
          patchSha256: proposal.patchSha256,
          repository: {
            name: proposal.repositoryName,
            url: proposal.repositoryUrl,
            branch: proposal.branch,
            pullRequestNumber: proposal.pullRequestNumber,
            commitSha: proposal.commitSha,
          },
          finding: {
            id: proposal.findingId,
            title: proposal.findingTitle,
            severity: proposal.findingSeverity,
            file: proposal.findingFile,
          },
          changedFiles: getChangedFilesFromPatch(proposal.patch),
        })
      } catch (error) {
        runnerFailure = error
      }
    }
    return this.store.completeAttempt(
      buildAttemptCompletion({
        attemptId: attempt.id,
        expectedPatchSha256: proposal.patchSha256,
        expectedCommitSha: proposal.commitSha,
        result,
        runnerConfigured: Boolean(this.runner),
        runnerFailure,
        startedAt,
        completedAt: this.now(),
      })
    )
  }
}

export class FixVerificationAttemptNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Verification attempt not found')
    this.name = 'FixVerificationAttemptNotFoundError'
  }
}

export class FixVerificationReviewConflictError extends Error {
  readonly statusCode = 409

  constructor(message = 'This verification attempt cannot be reviewed in its current state.') {
    super(message)
    this.name = 'FixVerificationReviewConflictError'
  }
}

export interface FixVerificationEvidenceStore {
  listOwned(
    userId: string,
    filters: z.infer<typeof verificationDashboardFilterSchema>
  ): Promise<FixVerificationDashboard>
  findOwnedAttempt(
    userId: string,
    attemptId: string
  ): Promise<FixProposalRecord['attempts'][number] | null>
  recordHumanDecision(input: {
    userId: string
    attemptId: string
    decision: FixVerificationReviewDecision
    note: string | null
    reviewedAt: Date
  }): Promise<FixProposalRecord['attempts'][number]>
}

function buildOwnedAttemptWhere(userId: string, attemptId?: string) {
  return {
    ...(attemptId ? { id: attemptId } : {}),
    proposal: {
      is: {
        userId,
        finding: { is: { review: { is: { userId } } } },
      },
    },
  }
}

const prismaFixVerificationEvidenceStore: FixVerificationEvidenceStore = {
  async listOwned(userId, filters) {
    const where: Prisma.FixVerificationAttemptWhereInput = {
      ...buildOwnedAttemptWhere(userId),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.repositoryId
        ? {
            proposal: {
              is: {
                userId,
                finding: { is: { review: { is: { userId, repositoryId: filters.repositoryId } } } },
              },
            },
          }
        : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    }

    const [total, verified, failed, needsReview, attempts, repositories] = await Promise.all([
      prisma.fixVerificationAttempt.count({ where }),
      prisma.fixVerificationAttempt.count({ where: { ...where, status: 'VERIFIED' } }),
      prisma.fixVerificationAttempt.count({ where: { ...where, status: 'FAILED' } }),
      prisma.fixVerificationAttempt.count({ where: { ...where, status: 'NEEDS_REVIEW' } }),
      prisma.fixVerificationAttempt.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_VERIFICATION_DASHBOARD_RUNS,
        include: {
          proposal: {
            select: {
              finding: {
                select: {
                  id: true,
                  review: {
                    select: {
                      id: true,
                      repositoryId: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.repository.findMany({
        where: { userId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ])

    return {
      total,
      verified,
      failed,
      needsReview,
      repositories,
      runs: attempts.map((attempt) => ({
        id: attempt.id,
        reviewId: attempt.proposal.finding.review.id,
        findingId: attempt.proposal.finding.id,
        findingTitle: attempt.findingTitle,
        findingSeverity: attempt.findingSeverity,
        findingFile: attempt.findingFile,
        repositoryId: attempt.proposal.finding.review.repositoryId,
        repositoryName: attempt.repositoryName,
        repositoryUrl: attempt.repositoryUrl,
        branch: attempt.branch,
        pullRequestNumber: attempt.pullRequestNumber,
        commitSha: attempt.commitSha,
        changedFiles: attempt.changedFiles,
        patchSha256: attempt.patchSha256,
        status: attempt.status,
        executionStatus: attempt.executionStatus,
        testCommands: parseVerificationCommands(attempt.testCommands),
        checkResults: parseVerificationCheckResults(attempt.checkResults),
        testsPassed: attempt.testsPassed,
        executionDurationMs: attempt.executionDurationMs,
        exitCode: attempt.exitCode,
        failureDetails: attempt.failureDetails,
        humanReviewDecision: attempt.humanReviewDecision,
        humanReviewNote: attempt.humanReviewNote,
        humanReviewedAt: attempt.humanReviewedAt,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
        sanitizedLogs: attempt.sanitizedLogs,
        jobState: attempt.jobState,
        executionOccurred: attempt.executionOccurred,
        runnerIdentity: attempt.runnerIdentity,
        runnerVersion: attempt.runnerVersion,
        retryCount: attempt.retryCount,
        runnerRunId: attempt.runnerRunId,
      })),
    }
  },

  async findOwnedAttempt(userId, attemptId) {
    return prisma.fixVerificationAttempt.findFirst({
      where: buildOwnedAttemptWhere(userId, attemptId),
    })
  },

  async recordHumanDecision(input) {
    return prisma.$transaction(
      async (transaction) => {
        const where = buildOwnedAttemptWhere(input.userId, input.attemptId)
        const attempt = await transaction.fixVerificationAttempt.findFirst({
          where,
          select: { id: true, status: true, humanReviewedAt: true },
        })
        if (!attempt) throw new FixVerificationAttemptNotFoundError()
        if (attempt.status === 'RUNNING') {
          throw new FixVerificationReviewConflictError('A running verification cannot be reviewed.')
        }
        if (attempt.humanReviewedAt) {
          throw new FixVerificationReviewConflictError(
            'A human decision has already been recorded.'
          )
        }

        const updated = await transaction.fixVerificationAttempt.updateMany({
          where: { ...where, humanReviewedAt: null },
          data: {
            humanReviewDecision: input.decision,
            humanReviewNote: input.note,
            humanReviewedAt: input.reviewedAt,
            humanReviewerId: input.userId,
          },
        })
        if (updated.count !== 1) {
          throw new FixVerificationReviewConflictError(
            'The verification was reviewed concurrently.'
          )
        }

        const saved = await transaction.fixVerificationAttempt.findUnique({
          where: { id: input.attemptId },
        })
        if (!saved) throw new FixVerificationAttemptNotFoundError()
        return saved
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  },
}

export class FixVerificationEvidenceService {
  constructor(
    private readonly store: FixVerificationEvidenceStore = prismaFixVerificationEvidenceStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  async list(userId: string, input: unknown): Promise<FixVerificationDashboard> {
    const filters = verificationDashboardFilterSchema.safeParse(input)
    if (!filters.success) throw new FixProposalValidationError('Invalid verification filters.')
    return this.store.listOwned(userId, filters.data)
  }

  async get(userId: string, attemptId: string): Promise<FixProposalRecord['attempts'][number]> {
    const attempt = await this.store.findOwnedAttempt(userId, attemptId)
    if (!attempt) throw new FixVerificationAttemptNotFoundError()
    return attempt
  }

  async review(
    userId: string,
    attemptId: string,
    input: unknown
  ): Promise<FixProposalRecord['attempts'][number]> {
    const decision = submitHumanReviewSchema.safeParse(input)
    if (!decision.success) throw new FixProposalValidationError('Invalid human review decision.')
    return this.store.recordHumanDecision({
      userId,
      attemptId,
      decision: decision.data.decision,
      note: decision.data.note?.trim() || null,
      reviewedAt: this.now(),
    })
  }
}
