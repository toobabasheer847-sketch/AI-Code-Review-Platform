import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { hasProReviewAccess, FREE_MONTHLY_REVIEW_LIMIT, ReviewQuotaExceededError } from './review-quota'

export async function reserveWorkspaceReviewQuota(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  now = new Date()
): Promise<void> {
  const billing = await transaction.workspaceBillingAccount.findUnique({
    where: { organizationId },
    select: { plan: true, status: true, currentPeriodEnd: true },
  })
  const hasProAccess = hasProReviewAccess(billing, now)
  const reserved = await transaction.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "WorkspaceUsage" ("id", "organizationId", "reviewCount", "month", "year", "createdAt")
    VALUES (
      ${randomUUID()},
      ${organizationId},
      1,
      ${now.getUTCMonth() + 1},
      ${now.getUTCFullYear()},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organizationId", "month", "year")
    DO UPDATE SET "reviewCount" = "WorkspaceUsage"."reviewCount" + 1
    WHERE ${hasProAccess} OR "WorkspaceUsage"."reviewCount" < ${FREE_MONTHLY_REVIEW_LIMIT}
    RETURNING "id"
  `
  if (reserved.length === 0) throw new ReviewQuotaExceededError()
}

export async function releaseWorkspaceReviewQuota(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  now = new Date()
): Promise<void> {
  await transaction.$executeRaw`
    UPDATE "WorkspaceUsage"
    SET "reviewCount" = "reviewCount" - 1
    WHERE "organizationId" = ${organizationId}
      AND "month" = ${now.getUTCMonth() + 1}
      AND "year" = ${now.getUTCFullYear()}
      AND "reviewCount" > 0
  `
}
