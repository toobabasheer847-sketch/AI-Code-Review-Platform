import { prisma } from '@/config/database'

import {
  betaLimitations,
  onboardingSteps,
  parseFeedbackDraft,
  parseFeedbackStatus,
  type BetaStatus,
  type FeedbackCategory,
  type FeedbackStatus,
  type ProductEventName,
  productEventNames,
} from './beta.domain'
import { recordProductEvent } from './product-events'

export class BetaServiceError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'BetaServiceError'
    this.statusCode = statusCode
  }
}

export interface ProductFeedbackRecord {
  id: string
  userId: string
  category: FeedbackCategory
  status: FeedbackStatus
  subject: string
  body: string
  rating: number | null
  reviewId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface BetaUserRecord {
  id: string
  email: string
  fullName: string
  betaStatus: BetaStatus
  createdAt: Date
}

export interface BetaGuide {
  limitations: readonly string[]
  dismissed: boolean
  steps: ReturnType<typeof onboardingSteps>
}

export interface BetaStore {
  createFeedback(input: Omit<ProductFeedbackRecord, 'id' | 'status' | 'createdAt' | 'updatedAt'> & {
    status?: FeedbackStatus
  }): Promise<ProductFeedbackRecord>
  listFeedback(userId?: string, category?: FeedbackCategory): Promise<ProductFeedbackRecord[]>
  updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<ProductFeedbackRecord | null>
  userOwnsReview(userId: string, reviewId: string): Promise<boolean>
  listUsers(): Promise<BetaUserRecord[]>
  setBetaStatus(userId: string, status: BetaStatus): Promise<boolean>
  dismissOnboarding(userId: string, at: Date): Promise<void>
  guide(userId: string): Promise<BetaGuide>
  eventCounts(): Promise<Record<ProductEventName, number>>
}

function emptyCounts(): Record<ProductEventName, number> {
  return {
    REGISTRATION: 0,
    WORKSPACE_CREATED: 0,
    REPOSITORY_CONNECTED: 0,
    REVIEW_STARTED: 0,
    REVIEW_COMPLETED: 0,
    REPO_CHAT: 0,
    FEEDBACK_SUBMITTED: 0,
  }
}

export const prismaBetaStore: BetaStore = {
  async createFeedback(input) {
    const created = await prisma.productFeedback.create({
      data: {
        userId: input.userId,
        category: input.category,
        subject: input.subject,
        body: input.body,
        rating: input.rating,
        reviewId: input.reviewId,
      },
    })
    return created
  },

  async listFeedback(userId, category) {
    return prisma.productFeedback.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  },

  async updateFeedbackStatus(id, status) {
    const existing = await prisma.productFeedback.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return null
    return prisma.productFeedback.update({ where: { id }, data: { status } })
  },

  async userOwnsReview(userId, reviewId) {
    const review = await prisma.codeReview.findFirst({
      where: { id: reviewId, userId },
      select: { id: true },
    })
    return review !== null
  },

  async listUsers() {
    return prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, email: true, fullName: true, betaStatus: true, createdAt: true },
    })
  },

  async setBetaStatus(userId, status) {
    const updated = await prisma.user.updateMany({ where: { id: userId }, data: { betaStatus: status } })
    return updated.count === 1
  },

  async dismissOnboarding(userId, at) {
    await prisma.user.update({ where: { id: userId }, data: { onboardingDismissedAt: at } })
  },

  async guide(userId) {
    const [user, workspaceCount, reviewCount, githubAccount] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { onboardingDismissedAt: true } }),
      prisma.workspaceMembership.count({
        where: { userId, status: 'ACTIVE', workspace: { isPersonal: false } },
      }),
      prisma.codeReview.count({ where: { userId } }),
      prisma.gitHubAccount.findUnique({ where: { userId }, select: { id: true } }),
    ])
    return {
      limitations: betaLimitations,
      dismissed: user?.onboardingDismissedAt != null,
      steps: onboardingSteps({
        workspaceCount,
        githubConnected: githubAccount !== null,
        reviewCount,
      }),
    }
  },

  async eventCounts() {
    const grouped = await prisma.productEvent.groupBy({ by: ['name'], _count: { _all: true } })
    const counts = emptyCounts()
    for (const row of grouped) {
      if (productEventNames.includes(row.name)) counts[row.name] = row._count._all
    }
    return counts
  },
}

export class BetaService {
  constructor(private readonly store: BetaStore = prismaBetaStore) {}

  guide(userId: string): Promise<BetaGuide> {
    return this.store.guide(userId)
  }

  dismissOnboarding(userId: string): Promise<void> {
    return this.store.dismissOnboarding(userId, new Date())
  }

  async submit(userId: string, input: unknown): Promise<ProductFeedbackRecord> {
    let draft
    try {
      draft = parseFeedbackDraft(input)
    } catch (error) {
      throw new BetaServiceError(400, error instanceof Error ? error.message : 'Feedback is invalid')
    }
    if (draft.reviewId) {
      const ownsReview = await this.store.userOwnsReview(userId, draft.reviewId)
      if (!ownsReview) throw new BetaServiceError(404, 'Review was not found')
    }
    const created = await this.store.createFeedback({
      userId,
      category: draft.category,
      subject: draft.subject,
      body: draft.body,
      rating: draft.rating ?? null,
      reviewId: draft.reviewId ?? null,
    })
    await recordProductEvent(userId, 'FEEDBACK_SUBMITTED')
    return created
  }

  listOwn(userId: string, category?: FeedbackCategory): Promise<ProductFeedbackRecord[]> {
    return this.store.listFeedback(userId, category)
  }

  async updateStatus(id: string, input: unknown): Promise<ProductFeedbackRecord> {
    let status: FeedbackStatus
    try {
      const record = input && typeof input === 'object' ? (input as { status?: unknown }).status : undefined
      status = parseFeedbackStatus(record)
    } catch (error) {
      throw new BetaServiceError(400, error instanceof Error ? error.message : 'Feedback status is invalid')
    }
    const updated = await this.store.updateFeedbackStatus(id, status)
    if (!updated) throw new BetaServiceError(404, 'Feedback was not found')
    return updated
  }

  async overview(): Promise<{
    users: BetaUserRecord[]
    feedback: ProductFeedbackRecord[]
    usage: Record<ProductEventName, number>
  }> {
    const [users, feedback, usage] = await Promise.all([
      this.store.listUsers(),
      this.store.listFeedback(),
      this.store.eventCounts(),
    ])
    return { users, feedback, usage }
  }

  async setAccess(userId: string, input: unknown): Promise<void> {
    const status = input && typeof input === 'object' ? (input as { betaStatus?: unknown }).betaStatus : undefined
    if (status !== 'ACTIVE' && status !== 'PENDING' && status !== 'REVOKED') {
      throw new BetaServiceError(400, 'Beta status is invalid')
    }
    const updated = await this.store.setBetaStatus(userId, status)
    if (!updated) throw new BetaServiceError(404, 'User was not found')
  }
}
