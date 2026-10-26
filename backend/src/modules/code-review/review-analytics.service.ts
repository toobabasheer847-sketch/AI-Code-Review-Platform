import { Prisma } from '@prisma/client';
import { prisma } from '@/config/database';
import {
  parseReviewAnalyticsFilter,
  summarizeReviewAnalytics,
  type ReviewAnalyticsFilter,
  type ReviewAnalyticsSnapshot,
} from './review-analytics.domain';

export class ReviewAnalyticsRepositoryNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Repository not found');
    this.name = 'ReviewAnalyticsRepositoryNotFoundError';
  }
}

export interface ReviewAnalyticsStore {
  ownsRepository(userId: string, repositoryId: string): Promise<boolean>;
  readSnapshot(userId: string, filter: ReviewAnalyticsFilter): Promise<ReviewAnalyticsSnapshot>;
}

const prismaReviewAnalyticsStore: ReviewAnalyticsStore = {
  async ownsRepository(userId, repositoryId) {
    return (
      (await prisma.repository.count({
        where: { id: repositoryId, userId },
      })) === 1
    );
  },

  async readSnapshot(userId, filter) {
    const reviewWhere: Prisma.CodeReviewWhereInput = {
      userId,
      ...(filter.repositoryId ? { repositoryId: filter.repositoryId } : {}),
      ...(filter.from || filter.toExclusive
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.toExclusive ? { lt: filter.toExclusive } : {}),
            },
          }
        : {}),
    };
    const findingWhere: Prisma.FindingWhereInput = {
      review: { is: reviewWhere },
    };

    const [
      reviewTotal,
      reviewsByStatus,
      findingsBySeverity,
      findingsByStatus,
      verificationsByStatus,
      pullRequestDeliveriesByStatus,
    ] = await Promise.all([
      prisma.codeReview.count({ where: reviewWhere }),
      prisma.codeReview.groupBy({
        by: ['status'],
        where: reviewWhere,
        _count: { _all: true },
      }),
      prisma.finding.groupBy({
        by: ['severity'],
        where: findingWhere,
        _count: { _all: true },
      }),
      prisma.finding.groupBy({
        by: ['status'],
        where: findingWhere,
        _count: { _all: true },
      }),
      prisma.findingVerificationRecord.groupBy({
        by: ['status'],
        where: { finding: { is: { review: { is: reviewWhere } } } },
        _count: { _all: true },
      }),
      prisma.gitHubWebhookDelivery.groupBy({
        by: ['status'],
        where: {
          review: {
            is: {
              ...reviewWhere,
              source: 'PULL_REQUEST',
            },
          },
        },
        _count: { _all: true },
      }),
    ]);

    const toCounts = <T extends { _count: { _all: number } }>(
      rows: T[],
      keyOf: (row: T) => string
    ): Record<string, number> =>
      Object.fromEntries(rows.map((row) => [keyOf(row), row._count._all]));

    return {
      reviewTotal,
      reviewsByStatus: toCounts(reviewsByStatus, (row) => row.status),
      findingsBySeverity: toCounts(findingsBySeverity, (row) => row.severity),
      findingsByStatus: toCounts(findingsByStatus, (row) => row.status),
      verificationsByStatus: toCounts(verificationsByStatus, (row) => row.status),
      pullRequestDeliveriesByStatus: toCounts(pullRequestDeliveriesByStatus, (row) => row.status),
    };
  },
};

export class ReviewAnalyticsService {
  constructor(private readonly store: ReviewAnalyticsStore = prismaReviewAnalyticsStore) {}

  async get(userId: string, input: unknown) {
    const filter = parseReviewAnalyticsFilter(input);
    if (filter.repositoryId && !(await this.store.ownsRepository(userId, filter.repositoryId))) {
      throw new ReviewAnalyticsRepositoryNotFoundError();
    }
    const snapshot = await this.store.readSnapshot(userId, filter);
    return summarizeReviewAnalytics(filter, snapshot);
  }
}
