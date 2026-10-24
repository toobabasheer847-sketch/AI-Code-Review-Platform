import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/config/database'

export const findingVerificationMethods = ['STATIC_ANALYSIS', 'TARGETED_TEST'] as const
export const MAX_FINDING_VERIFICATION_REQUESTS = 5

export const requestFindingVerificationSchema = z
  .object({
    requestKey: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .refine((key) => !key.startsWith('ai-review:'), 'Reserved verification request key'),
    method: z.enum(findingVerificationMethods),
  })
  .strict()

export interface FindingVerificationRecord {
  id: string
  findingId: string
  requestKey: string
  status: 'AI_REPORTED' | 'VERIFIED' | 'VERIFICATION_FAILED' | 'INCONCLUSIVE'
  method: string
  resultSummary: string
  sourceRevision: string | null
  diagnosticSummary: string | null
  executionOccurred: boolean
  toolIdentity: string | null
  exitCode: number | null
  durationMs: number
  startedAt: Date
  completedAt: Date
  createdAt: Date
}

export interface FindingVerificationStore {
  findOwnedFinding(
    userId: string,
    findingId: string
  ): Promise<{ id: string; sourceRevision: string | null } | null>
  findOwnedRecord(
    userId: string,
    findingId: string,
    requestKey: string
  ): Promise<FindingVerificationRecord | null>
  createUnavailableRecord(input: {
    userId: string
    findingId: string
    requestKey: string
    method: (typeof findingVerificationMethods)[number]
    sourceRevision: string | null
    startedAt: Date
    completedAt: Date
  }): Promise<FindingVerificationRecord>
}

export class FindingVerificationNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Finding not found')
    this.name = 'FindingVerificationNotFoundError'
  }
}

export class FindingVerificationLimitError extends Error {
  readonly statusCode = 409

  constructor() {
    super('This finding has reached the verification request limit.')
    this.name = 'FindingVerificationLimitError'
  }
}

const prismaFindingVerificationStore: FindingVerificationStore = {
  async findOwnedFinding(userId, findingId) {
    return prisma.finding.findFirst({
      where: { id: findingId, review: { is: { userId } } },
      select: {
        id: true,
        review: { select: { sourceRevision: true } },
      },
    }).then((finding) =>
      finding
        ? { id: finding.id, sourceRevision: finding.review.sourceRevision }
        : null
    )
  },

  async findOwnedRecord(userId, findingId, requestKey) {
    return prisma.findingVerificationRecord.findFirst({
      where: {
        findingId,
        requestKey,
        finding: { review: { is: { userId } } },
      },
    })
  },

  async createUnavailableRecord(input) {
    return prisma.$transaction(async (transaction) => {
      const finding = await transaction.finding.findFirst({
        where: {
          id: input.findingId,
          review: { is: { userId: input.userId } },
        },
        select: { review: { select: { sourceRevision: true } } },
      })
      if (!finding) throw new FindingVerificationNotFoundError()

      const requestCount = await transaction.findingVerificationRecord.count({
        where: {
          findingId: input.findingId,
          method: { not: 'AI_REVIEW' },
        },
      })
      if (requestCount >= MAX_FINDING_VERIFICATION_REQUESTS) {
        throw new FindingVerificationLimitError()
      }

      const sourceIsCurrent =
        input.sourceRevision !== null &&
        finding.review.sourceRevision === input.sourceRevision
      const missingRevision = input.sourceRevision === null
      const resultSummary = !sourceIsCurrent
        ? missingRevision
          ? 'Verification is inconclusive because this review has no pinned source revision.'
          : 'Verification is inconclusive because the review source revision has changed.'
        : 'No isolated verification runner is configured. The requested check was not executed.'
      const diagnosticSummary = !sourceIsCurrent
        ? 'No verification command was executed; the source revision is missing or stale.'
        : 'No sandbox runner or approved static-analysis tool is configured; no repository code was executed.'

      return transaction.findingVerificationRecord.create({
        data: {
          findingId: input.findingId,
          requestKey: input.requestKey,
          status: 'INCONCLUSIVE',
          method: input.method,
          resultSummary,
          sourceRevision: input.sourceRevision,
          diagnosticSummary,
          executionOccurred: false,
          toolIdentity: null,
          exitCode: null,
          durationMs: 0,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export class FindingVerificationService {
  constructor(
    private readonly store: FindingVerificationStore = prismaFindingVerificationStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  async request(
    userId: string,
    findingId: string,
    input: unknown
  ): Promise<FindingVerificationRecord> {
    const parsed = requestFindingVerificationSchema.safeParse(input)
    if (!parsed.success) throw new Error('Invalid verification request')

    const finding = await this.store.findOwnedFinding(userId, findingId)
    if (!finding) throw new FindingVerificationNotFoundError()

    const previous = await this.store.findOwnedRecord(
      userId,
      findingId,
      parsed.data.requestKey
    )
    if (previous) return previous

    const timestamp = this.now()
    try {
      return await this.store.createUnavailableRecord({
        userId,
        findingId,
        requestKey: parsed.data.requestKey,
        method: parsed.data.method,
        sourceRevision: finding.sourceRevision,
        startedAt: timestamp,
        completedAt: timestamp,
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const duplicate = await this.store.findOwnedRecord(
        userId,
        findingId,
        parsed.data.requestKey
      )
      if (duplicate) return duplicate
      throw error
    }
  }

  async get(
    userId: string,
    findingId: string,
    requestKey: string
  ): Promise<FindingVerificationRecord> {
    const finding = await this.store.findOwnedFinding(userId, findingId)
    if (!finding) throw new FindingVerificationNotFoundError()
    const record = await this.store.findOwnedRecord(userId, findingId, requestKey)
    if (!record) throw new FindingVerificationNotFoundError()
    return record
  }
}
