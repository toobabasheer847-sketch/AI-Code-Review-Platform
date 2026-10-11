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

export function hasProReviewAccess(
  subscription: {
    plan: string
    status: string
    currentPeriodEnd: Date | null
  } | null,
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
  const subscription = await transaction.subscription.findUnique({
    where: { userId },
  })
  const hasProAccess = hasProReviewAccess(subscription, now)
  const month = now.getUTCMonth() + 1
  const year = now.getUTCFullYear()
  const updated = await transaction.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "Usage" ("id", "userId", "reviewCount", "month", "year", "createdAt")
    VALUES (${randomUUID()}, ${userId}, 1, ${month}, ${year}, CURRENT_TIMESTAMP)
    ON CONFLICT ("userId", "month", "year")
    DO UPDATE SET "reviewCount" = "Usage"."reviewCount" + 1
    WHERE ${hasProAccess} OR "Usage"."reviewCount" < ${FREE_MONTHLY_REVIEW_LIMIT}
    RETURNING "id"
  `

  if (updated.length === 0) {
    throw new ReviewQuotaExceededError()
  }
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
