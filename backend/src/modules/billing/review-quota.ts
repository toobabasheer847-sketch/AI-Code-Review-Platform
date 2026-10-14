import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'

export const FREE_MONTHLY_REVIEW_LIMIT = 3

export class ReviewQuotaExceededError extends Error {
  readonly statusCode = 402

  constructor() {
    super('Free plan limit reached. Upgrade to Pro to continue.')
    this.name = 'ReviewQuotaExceededError'
  }
}

interface SubscriptionAccess {
  plan: string
  status: string
  currentPeriodEnd: Date | null
}

export interface ReviewQuotaStore {
  findSubscription(userId: string): Promise<SubscriptionAccess | null>
  reserveUsage(input: {
    userId: string
    month: number
    year: number
    hasProAccess: boolean
    freeLimit: number
  }): Promise<boolean>
}

export function hasProReviewAccess(
  subscription: SubscriptionAccess | null,
  now: Date
): boolean {
  if (subscription?.plan !== 'PRO') {
    return false
  }

  const periodIsCurrent =
    subscription.currentPeriodEnd === null || subscription.currentPeriodEnd > now
  const subscriptionIsEntitled =
    subscription.status === 'ACTIVE' ||
    (subscription.status === 'CANCELED' && subscription.currentPeriodEnd !== null)

  return subscriptionIsEntitled && periodIsCurrent
}

export async function reserveReviewQuota(
  transaction: Prisma.TransactionClient,
  userId: string,
  now = new Date()
): Promise<void> {
  return reserveReviewQuotaWithStore(
    {
      findSubscription: (id) =>
        transaction.subscription.findUnique({ where: { userId: id } }),
      async reserveUsage(input) {
        const updated = await transaction.$queryRaw<Array<{ id: string }>>`
          INSERT INTO "Usage" ("id", "userId", "reviewCount", "month", "year", "createdAt")
          VALUES (${randomUUID()}, ${input.userId}, 1, ${input.month}, ${input.year}, CURRENT_TIMESTAMP)
          ON CONFLICT ("userId", "month", "year")
          DO UPDATE SET "reviewCount" = "Usage"."reviewCount" + 1
          WHERE ${input.hasProAccess} OR "Usage"."reviewCount" < ${input.freeLimit}
          RETURNING "id"
        `
        return updated.length > 0
      },
    },
    userId,
    now
  )
}

export async function reserveReviewQuotaWithStore(
  store: ReviewQuotaStore,
  userId: string,
  now = new Date()
): Promise<void> {
  const subscription = await store.findSubscription(userId)
  const reserved = await store.reserveUsage({
    userId,
    month: now.getUTCMonth() + 1,
    year: now.getUTCFullYear(),
    hasProAccess: hasProReviewAccess(subscription, now),
    freeLimit: FREE_MONTHLY_REVIEW_LIMIT,
  })

  if (!reserved) throw new ReviewQuotaExceededError()
}

export async function releaseReviewQuota(
  transaction: Prisma.TransactionClient,
  userId: string,
  now = new Date()
): Promise<void> {
  await transaction.$executeRaw`
    UPDATE "Usage"
    SET "reviewCount" = "reviewCount" - 1
    WHERE "userId" = ${userId}
      AND "month" = ${now.getUTCMonth() + 1}
      AND "year" = ${now.getUTCFullYear()}
      AND "reviewCount" > 0
  `
}
