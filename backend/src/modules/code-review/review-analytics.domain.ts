import { z } from 'zod';

const analyticsFilterSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    repositoryId: z.string().min(1).max(128).optional(),
  })
  .strict();

export interface ReviewAnalyticsFilter {
  from?: Date;
  toExclusive?: Date;
  repositoryId?: string;
}

export type AnalyticsCounts = Record<string, number>;

export interface ReviewAnalyticsSnapshot {
  reviewTotal: number;
  reviewsByStatus: AnalyticsCounts;
  findingsBySeverity: AnalyticsCounts;
  findingsByStatus: AnalyticsCounts;
  verificationsByStatus: AnalyticsCounts;
  pullRequestDeliveriesByStatus: AnalyticsCounts;
}

export class ReviewAnalyticsFilterError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ReviewAnalyticsFilterError';
  }
}

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ReviewAnalyticsFilterError('Date filters must be valid calendar dates.');
  }
  return date;
}

export function parseReviewAnalyticsFilter(input: unknown): ReviewAnalyticsFilter {
  const parsed = analyticsFilterSchema.safeParse(input);
  if (!parsed.success) throw new ReviewAnalyticsFilterError('Invalid analytics filters.');

  const from = parsed.data.from ? parseDate(parsed.data.from) : undefined;
  const to = parsed.data.to ? parseDate(parsed.data.to) : undefined;
  if (from && to && from > to) {
    throw new ReviewAnalyticsFilterError('The from date must not be later than the to date.');
  }

  const toExclusive = to ? new Date(to.getTime() + 24 * 60 * 60 * 1000) : undefined;
  return {
    ...(from ? { from } : {}),
    ...(toExclusive ? { toExclusive } : {}),
    ...(parsed.data.repositoryId ? { repositoryId: parsed.data.repositoryId } : {}),
  };
}

function count(counts: AnalyticsCounts, keys: string[]): number {
  return keys.reduce((total, key) => total + (counts[key] ?? 0), 0);
}

export function summarizeReviewAnalytics(
  filter: ReviewAnalyticsFilter,
  snapshot: ReviewAnalyticsSnapshot
) {
  const findingStatusCounts = snapshot.findingsByStatus;
  return {
    filters: {
      from: filter.from?.toISOString().slice(0, 10) ?? null,
      to: filter.toExclusive
        ? new Date(filter.toExclusive.getTime() - 1).toISOString().slice(0, 10)
        : null,
      repositoryId: filter.repositoryId ?? null,
    },
    reviews: {
      total: snapshot.reviewTotal,
      byStatus: snapshot.reviewsByStatus,
    },
    findings: {
      total: count(snapshot.findingsBySeverity, Object.keys(snapshot.findingsBySeverity)),
      bySeverity: snapshot.findingsBySeverity,
      byStatus: findingStatusCounts,
      outcomes: {
        confirmed: findingStatusCounts.CONFIRMED ?? 0,
        dismissed: findingStatusCounts.FALSE_POSITIVE ?? 0,
        unresolved: findingStatusCounts.UNREVIEWED ?? 0,
        fixed: findingStatusCounts.FIXED ?? 0,
        duplicate: findingStatusCounts.DUPLICATE ?? 0,
        wontFix: findingStatusCounts.WONT_FIX ?? 0,
      },
    },
    verifications: {
      byStatus: snapshot.verificationsByStatus,
      aiReported: snapshot.verificationsByStatus.AI_REPORTED ?? 0,
      verified: snapshot.verificationsByStatus.VERIFIED ?? 0,
      failed: snapshot.verificationsByStatus.VERIFICATION_FAILED ?? 0,
      inconclusive: snapshot.verificationsByStatus.INCONCLUSIVE ?? 0,
    },
    pullRequestReviews: {
      totalDeliveries: count(
        snapshot.pullRequestDeliveriesByStatus,
        Object.keys(snapshot.pullRequestDeliveriesByStatus)
      ),
      publicationsByStatus: snapshot.pullRequestDeliveriesByStatus,
      ciCheckResultsAvailable: false,
    },
  };
}
