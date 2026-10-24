import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/config/database'
import { sanitizeVerificationLogs } from './fix-verification.domain'

const independentVerificationMethods = ['STATIC_ANALYSIS', 'TARGETED_TEST'] as const
const independentVerificationStatuses = [
  'VERIFIED',
  'VERIFICATION_FAILED',
  'INCONCLUSIVE',
] as const

export const recordFindingVerificationSchema = z
  .object({
    requestKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
    status: z.enum(independentVerificationStatuses),
    method: z.enum(independentVerificationMethods),
    resultSummary: z.string().trim().min(1).max(500),
    diagnosticSummary: z.string().max(8_000).optional(),
    sourceRevision: z.string().regex(/^[\da-f]{40,64}$/i),
  })
  .strict()

export type FindingVerificationInput = z.infer<typeof recordFindingVerificationSchema>

export interface FindingVerificationRecord {
  id: string
  findingId: string
  requestKey: string
  status: 'AI_REPORTED' | 'VERIFIED' | 'VERIFICATION_FAILED' | 'INCONCLUSIVE'
  method: string
  resultSummary: string
  sourceRevision: string | null
  diagnosticSummary: string | null
  startedAt: Date
  completedAt: Date
  createdAt: Date
}

export interface FindingVerificationStore {
  findRecord(findingId: string, requestKey: string): Promise<FindingVerificationRecord | null>
  createRecord(
    input: Omit<FindingVerificationInput, 'diagnosticSummary'> & {
      findingId: string
      diagnosticSummary: string | null
      startedAt: Date
      completedAt: Date
    }
  ): Promise<FindingVerificationRecord>
}

export class FindingVerificationNotFoundError extends Error {
  constructor() {
    super('Finding not found')
    this.name = 'FindingVerificationNotFoundError'
  }
}

const prismaFindingVerificationStore: FindingVerificationStore = {
  async findRecord(findingId, requestKey) {
    return prisma.findingVerificationRecord.findUnique({
      where: { findingId_requestKey: { findingId, requestKey } },
    })
  },

  async createRecord(input) {
    return prisma.$transaction(async (transaction) => {
      const finding = await transaction.finding.findUnique({
        where: { id: input.findingId },
        select: { review: { select: { sourceRevision: true } } },
      })
      if (!finding) throw new FindingVerificationNotFoundError()

      const sourceIsCurrent = finding.review.sourceRevision === input.sourceRevision
      return transaction.findingVerificationRecord.create({
        data: {
          findingId: input.findingId,
          requestKey: input.requestKey,
          status: sourceIsCurrent ? input.status : 'INCONCLUSIVE',
          method: input.method,
          resultSummary: sourceIsCurrent
            ? input.resultSummary
            : 'Verification result was discarded because the review source revision has changed.',
          sourceRevision: input.sourceRevision,
          diagnosticSummary: sourceIsCurrent
            ? input.diagnosticSummary
            : 'The result applies to a stale source revision and was not used.',
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

function sanitizedText(value: string | undefined, limit: number): string | null {
  if (!value) return null
  return Array.from(sanitizeVerificationLogs(value)).slice(0, limit).join('')
}

export class FindingVerificationService {
  constructor(
    private readonly store: FindingVerificationStore = prismaFindingVerificationStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  async record(
    findingId: string,
    input: unknown
  ): Promise<FindingVerificationRecord> {
    const parsed = recordFindingVerificationSchema.safeParse(input)
    if (!parsed.success) throw new Error('Invalid trusted verification result')

    const previous = await this.store.findRecord(findingId, parsed.data.requestKey)
    if (previous) return previous

    const timestamp = this.now()
    const normalizedInput = {
      ...parsed.data,
      resultSummary:
        sanitizedText(parsed.data.resultSummary, 500) ??
        'Verification result was empty after sanitization.',
      diagnosticSummary: sanitizedText(parsed.data.diagnosticSummary, 2_000),
      startedAt: timestamp,
      completedAt: timestamp,
    }

    try {
      return await this.store.createRecord({
        findingId,
        ...normalizedInput,
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const duplicate = await this.store.findRecord(findingId, parsed.data.requestKey)
      if (duplicate) return duplicate
      throw error
    }
  }
}
