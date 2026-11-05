import { AIRequestStatus, Prisma } from '@prisma/client'
import { prisma } from '@/config/database'
import { getPersonalWorkspaceId } from '@/modules/workspaces/workspace.service'

export interface AIUsageFilters {
  from?: Date
  toExclusive?: Date
  page: number
  pageSize: number
}

export function ownedAIUsageWhere(
  userId: string,
  filters: Pick<AIUsageFilters, 'from' | 'toExclusive'>,
  workspaceId?: string
): Prisma.AiRequestUsageWhereInput {
  return {
    userId,
    ...(workspaceId ? { workspaceId } : {}),
    ...(filters.from || filters.toExclusive
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.toExclusive ? { lt: filters.toExclusive } : {}),
          },
        }
      : {}),
  }
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value)
}

export function mapAIUsageGroups<
  T extends {
    _count: {
      _all: number
      inputTokens: number
      outputTokens: number
      estimatedCostUsd: number
    }
    _sum: {
      inputTokens: number | null
      outputTokens: number | null
      estimatedCostUsd: number | null
    }
  },
>(rows: T[], getName: (row: T) => string) {
  return rows.map((row) => ({
    name: getName(row),
    requests: row._count._all,
    inputTokens:
      row._count.inputTokens === row._count._all ? row._sum.inputTokens : null,
    outputTokens:
      row._count.outputTokens === row._count._all ? row._sum.outputTokens : null,
    estimatedCostUsd:
      row._count.estimatedCostUsd === row._count._all
        ? nullableNumber(row._sum.estimatedCostUsd)
        : null,
  }))
}

export async function getAIUsageAnalytics(userId: string, filters: AIUsageFilters) {
  const workspaceId = await getPersonalWorkspaceId(userId)
  const where = ownedAIUsageWhere(userId, filters, workspaceId)
  const [
    totals,
    failures,
    featureGroups,
    modelGroups,
    trend,
    total,
    records,
  ] = await Promise.all([
    prisma.aiRequestUsage.aggregate({
      where,
      _count: {
        _all: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
      },
    }),
    prisma.aiRequestUsage.count({
      where: { ...where, status: AIRequestStatus.FAILED },
    }),
    prisma.aiRequestUsage.groupBy({
      by: ['feature'],
      where,
      _count: { _all: true, inputTokens: true, outputTokens: true, estimatedCostUsd: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostUsd: true },
      orderBy: { feature: 'asc' },
    }),
    prisma.aiRequestUsage.groupBy({
      by: ['modelName'],
      where,
      _count: { _all: true, inputTokens: true, outputTokens: true, estimatedCostUsd: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostUsd: true },
      orderBy: { modelName: 'asc' },
    }),
    prisma.$queryRaw<
      Array<{
        day: Date
        requests: bigint
        inputTokens: bigint | null
        inputTokenRequests: bigint
        outputTokens: bigint | null
        outputTokenRequests: bigint
        estimatedCostUsd: number | null
        costRequests: bigint
        failedRequests: bigint
      }>
    >`
      SELECT
        date_trunc('day', "createdAt") AS day,
        COUNT(*) AS requests,
        SUM("inputTokens") AS "inputTokens",
        COUNT("inputTokens") AS "inputTokenRequests",
        SUM("outputTokens") AS "outputTokens",
        COUNT("outputTokens") AS "outputTokenRequests",
        SUM("estimatedCostUsd") AS "estimatedCostUsd",
        COUNT("estimatedCostUsd") AS "costRequests",
        COUNT(*) FILTER (WHERE status = 'FAILED') AS "failedRequests"
      FROM "AIRequestUsage"
      WHERE "userId" = ${userId}
        AND "workspaceId" = ${workspaceId}
        ${filters.from ? Prisma.sql`AND "createdAt" >= ${filters.from}` : Prisma.empty}
        ${filters.toExclusive ? Prisma.sql`AND "createdAt" < ${filters.toExclusive}` : Prisma.empty}
      GROUP BY date_trunc('day', "createdAt")
      ORDER BY day ASC
    `,
    prisma.aiRequestUsage.count({ where }),
    prisma.aiRequestUsage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      select: {
        id: true,
        feature: true,
        provider: true,
        modelName: true,
        modelVersion: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
        pricingVersion: true,
        durationMs: true,
        status: true,
        errorCategory: true,
        reviewId: true,
        conversationId: true,
        automationId: true,
        createdAt: true,
      },
    }),
  ])

  return {
    totals: {
      requests: totals._count._all,
      inputTokens:
        totals._count.inputTokens === totals._count._all ? totals._sum.inputTokens : null,
      outputTokens:
        totals._count.outputTokens === totals._count._all ? totals._sum.outputTokens : null,
      totalTokens:
        totals._count.totalTokens === totals._count._all ? totals._sum.totalTokens : null,
      estimatedCostUsd:
        totals._count.estimatedCostUsd === totals._count._all
          ? nullableNumber(totals._sum.estimatedCostUsd)
          : null,
      failedRequests: failures,
    },
    byFeature: mapAIUsageGroups(featureGroups, (row) => row.feature),
    byModel: mapAIUsageGroups(modelGroups, (row) => row.modelName),
    trends: trend.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      requests: Number(row.requests),
      inputTokens:
        row.inputTokenRequests === row.requests && row.inputTokens !== null
          ? Number(row.inputTokens)
          : null,
      outputTokens:
        row.outputTokenRequests === row.requests && row.outputTokens !== null
          ? Number(row.outputTokens)
          : null,
      estimatedCostUsd:
        row.costRequests === row.requests ? nullableNumber(row.estimatedCostUsd) : null,
      failedRequests: Number(row.failedRequests),
    })),
    records,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    },
  }
}
