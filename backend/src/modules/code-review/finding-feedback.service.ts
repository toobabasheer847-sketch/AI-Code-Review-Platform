import { FindingFeedbackCategory, Prisma } from '@prisma/client'
import { prisma } from '@/config/database'
import { getPersonalWorkspaceId } from '@/modules/workspaces/workspace.service'
import {
  submitFindingFeedbackSchema,
  type FindingFeedbackAssessment,
  type FindingFeedbackCategoryValue,
} from './finding-feedback.domain'

export class FindingFeedbackFindingNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Finding not found')
    this.name = 'FindingFeedbackFindingNotFoundError'
  }
}

export class FindingFeedbackIdempotencyConflictError extends Error {
  readonly statusCode = 409

  constructor() {
    super('This feedback request key was already used with different feedback.')
    this.name = 'FindingFeedbackIdempotencyConflictError'
  }
}

export class InvalidFindingFeedbackError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Invalid finding feedback.')
    this.name = 'InvalidFindingFeedbackError'
  }
}

export interface FindingFeedbackStore {
  findOwnedFinding(
    userId: string,
    findingId: string
  ): Promise<{ id: string; repositoryId: string } | null>
  findByRequestKey(
    findingId: string,
    userId: string,
    requestKey: string
  ): Promise<FindingFeedbackAssessment | null>
  create(input: {
    findingId: string
    userId: string
    repositoryId: string
    requestKey: string
    category: FindingFeedbackCategoryValue
    explanation: string | null
  }): Promise<FindingFeedbackAssessment>
}

const prismaFindingFeedbackStore: FindingFeedbackStore = {
  async findOwnedFinding(userId, findingId) {
    const workspaceId = await getPersonalWorkspaceId(userId)
    const finding = await prisma.finding.findFirst({
      where: { id: findingId, review: { is: { userId, workspaceId } } },
      select: { id: true, review: { select: { repositoryId: true } } },
    })
    return finding ? { id: finding.id, repositoryId: finding.review.repositoryId } : null
  },

  async findByRequestKey(findingId, userId, requestKey) {
    const workspaceId = await getPersonalWorkspaceId(userId)
    return prisma.findingAssessmentFeedback.findFirst({
      where: {
        findingId,
        userId,
        requestKey,
        finding: { is: { review: { is: { userId, workspaceId } } } },
      },
      include: { user: { select: { fullName: true } } },
    })
  },

  async create(input) {
    return prisma.findingAssessmentFeedback.create({
      data: {
        ...input,
        category: input.category as FindingFeedbackCategory,
      },
      include: { user: { select: { fullName: true } } },
    })
  },
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function matchesSubmission(
  existing: FindingFeedbackAssessment,
  input: {
    category: FindingFeedbackCategoryValue
    explanation: string | null
  }
): boolean {
  return existing.category === input.category && existing.explanation === input.explanation
}

export class FindingFeedbackService {
  constructor(private readonly store: FindingFeedbackStore = prismaFindingFeedbackStore) {}

  async submit(
    userId: string,
    findingId: string,
    input: unknown
  ): Promise<FindingFeedbackAssessment> {
    const parsed = submitFindingFeedbackSchema.safeParse(input)
    if (!parsed.success) throw new InvalidFindingFeedbackError()

    const finding = await this.store.findOwnedFinding(userId, findingId)
    if (!finding) throw new FindingFeedbackFindingNotFoundError()

    const submission = {
      findingId,
      userId,
      repositoryId: finding.repositoryId,
      ...parsed.data,
    }
    const existing = await this.store.findByRequestKey(
      findingId,
      userId,
      parsed.data.requestKey
    )
    if (existing) {
      if (!matchesSubmission(existing, parsed.data)) {
        throw new FindingFeedbackIdempotencyConflictError()
      }
      return existing
    }

    try {
      return await this.store.create(submission)
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const duplicate = await this.store.findByRequestKey(
        findingId,
        userId,
        parsed.data.requestKey
      )
      if (!duplicate) throw error
      if (!matchesSubmission(duplicate, parsed.data)) {
        throw new FindingFeedbackIdempotencyConflictError()
      }
      return duplicate
    }
  }
}
