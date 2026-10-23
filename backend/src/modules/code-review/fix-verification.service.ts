import { Prisma } from '@prisma/client'
import { prisma } from '@/config/database'
import {
  classifyVerificationResult,
  createFixProposalSchema,
  FixProposalValidationError,
  hashFixPatch,
  sanitizeVerificationLogs,
  validateFixPatch,
  type VerificationExecutionResult,
} from './fix-verification.domain'

export const MAX_FIX_PROPOSALS_PER_FINDING = 10
export const MAX_VERIFICATION_ATTEMPTS_PER_PROPOSAL = 5

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
    status: 'RUNNING' | 'VERIFIED' | 'FAILED' | 'INCONCLUSIVE'
    executionStatus: 'NOT_RUN' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'BLOCKED'
    testCommands: unknown
    testsPassed: boolean | null
    originalIssueReproducedBefore: boolean | null
    originalIssueReproducedAfter: boolean | null
    startedAt: Date
    completedAt: Date | null
    sanitizedLogs: string | null
    createdAt: Date
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
    return prisma.$transaction(async (transaction) => {
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
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
  findOwnedProposal(userId: string, proposalId: string): Promise<{
    id: string
    findingId: string
    patchSha256: string
  } | null>
  findAttempt(proposalId: string, requestKey: string): Promise<FixProposalRecord['attempts'][number] | null>
  createAttempt(input: {
    proposalId: string
    requestedById: string
    requestKey: string
    patchSha256: string
    startedAt: Date
  }): Promise<FixProposalRecord['attempts'][number]>
  completeAttempt(input: {
    id: string
    status: 'VERIFIED' | 'FAILED' | 'INCONCLUSIVE'
    executionStatus: 'NOT_RUN' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'BLOCKED'
    testCommands: string[]
    testsPassed: boolean | null
    originalIssueReproducedBefore: boolean | null
    originalIssueReproducedAfter: boolean | null
    completedAt: Date
    sanitizedLogs: string
  }): Promise<FixProposalRecord['attempts'][number]>
}

const prismaTrustedVerificationStore: TrustedVerificationStore = {
  async findOwnedProposal(userId, proposalId) {
    return prisma.fixProposal.findFirst({
      where: { id: proposalId, userId, finding: { review: { is: { userId } } } },
      select: { id: true, findingId: true, patchSha256: true },
    })
  },

  async findAttempt(proposalId, requestKey) {
    return prisma.fixVerificationAttempt.findUnique({
      where: { proposalId_requestKey: { proposalId, requestKey } },
    })
  },

  async createAttempt(input) {
    return prisma.$transaction(async (transaction) => {
      const count = await transaction.fixVerificationAttempt.count({
        where: { proposalId: input.proposalId },
      })
      if (count >= MAX_VERIFICATION_ATTEMPTS_PER_PROPOSAL) {
        throw new FixVerificationLimitError()
      }
      return transaction.fixVerificationAttempt.create({
        data: {
          ...input,
          status: 'RUNNING',
          executionStatus: 'BLOCKED',
          testCommands: [],
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
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
        completedAt: input.completedAt,
        sanitizedLogs: input.sanitizedLogs,
      },
    })
  },
}

export interface TrustedVerificationRunner {
  execute(input: { proposalId: string; patchSha256: string }): Promise<VerificationExecutionResult>
}

export class FixVerificationService {
  constructor(
    private readonly store: TrustedVerificationStore = prismaTrustedVerificationStore,
    private readonly runner: TrustedVerificationRunner | null = null,
    private readonly now: () => Date = () => new Date()
  ) {}

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
    if (previous) return previous

    const startedAt = this.now()
    let attempt: FixProposalRecord['attempts'][number]
    try {
      attempt = await this.store.createAttempt({
        proposalId,
        requestedById: userId,
        requestKey,
        patchSha256: proposal.patchSha256,
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

    let result: VerificationExecutionResult | null = null
    let runnerFailure: unknown
    if (this.runner) {
      try {
        result = await this.runner.execute({ proposalId, patchSha256: proposal.patchSha256 })
      } catch (error) {
        runnerFailure = error
      }
    }
    const completedAt = this.now()
    if (!result) {
      return this.store.completeAttempt({
        id: attempt.id,
        status: 'INCONCLUSIVE',
        executionStatus: 'BLOCKED',
        testCommands: [],
        testsPassed: null,
        originalIssueReproducedBefore: null,
        originalIssueReproducedAfter: null,
        completedAt,
        sanitizedLogs: this.runner
          ? sanitizeVerificationLogs(
              `Runner failed before returning a result (${runnerFailure instanceof Error ? runnerFailure.name : 'unknown error'}); outcome is inconclusive.`
            )
          : 'No isolated verification runner is configured; the patch was not executed.',
      })
    }

    const status = classifyVerificationResult(proposal.patchSha256, result)
    return this.store.completeAttempt({
      id: attempt.id,
      status,
      executionStatus: result.executionStatus,
      testCommands: result.testCommands,
      testsPassed: result.testsPassed,
      originalIssueReproducedBefore: result.originalIssueReproducedBefore,
      originalIssueReproducedAfter: result.originalIssueReproducedAfter,
      completedAt,
      sanitizedLogs: sanitizeVerificationLogs(result.sanitizedLogs),
    })
  }
}
