import { Prisma } from '@prisma/client';
import { prisma } from '@/config/database';
import {
  summarizeFeedbackAnalytics,
  type FeedbackAnalyticsDataset,
  type ObjectiveVerificationStatus,
} from './feedback-analytics.domain';
import {
  parseReviewAnalyticsFilter,
  ReviewAnalyticsFilterError,
  type ReviewAnalyticsFilter,
} from './review-analytics.domain';

export class FeedbackAnalyticsRepositoryNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Repository not found');
    this.name = 'FeedbackAnalyticsRepositoryNotFoundError';
  }
}

export interface FeedbackAnalyticsStore {
  ownsRepository(userId: string, repositoryId: string): Promise<boolean>;
  read(userId: string, filter: ReviewAnalyticsFilter): Promise<FeedbackAnalyticsDataset>;
}

function createdAtFilter(filter: ReviewAnalyticsFilter): Prisma.DateTimeFilter | undefined {
  if (!filter.from && !filter.toExclusive) return undefined;
  return {
    ...(filter.from ? { gte: filter.from } : {}),
    ...(filter.toExclusive ? { lt: filter.toExclusive } : {}),
  };
}

const verificationStatuses = new Set<ObjectiveVerificationStatus>([
  'AI_REPORTED',
  'VERIFIED',
  'VERIFICATION_FAILED',
  'INCONCLUSIVE',
]);

const prismaFeedbackAnalyticsStore: FeedbackAnalyticsStore = {
  async ownsRepository(userId, repositoryId) {
    return (
      (await prisma.repository.count({
        where: { id: repositoryId, userId },
      })) === 1
    );
  },

  async read(userId, filter) {
    const findingCreatedAt = createdAtFilter(filter);
    const reviewCreatedAt = createdAtFilter(filter);
    const repositoryId = filter.repositoryId ?? '';
    const [findings, reviews] = await Promise.all([
      prisma.finding.findMany({
        where: {
          ...(findingCreatedAt ? { createdAt: findingCreatedAt } : {}),
          review: { is: { userId, repositoryId } },
        },
        select: {
          id: true,
          reviewId: true,
          file: true,
          line: true,
          endLine: true,
          severity: true,
          category: true,
          title: true,
          message: true,
          evidence: true,
          createdAt: true,
          independentlyVerifiedAt: true,
          assessmentFeedback: {
            select: { id: true, findingId: true, category: true, createdAt: true },
          },
          verificationRecords: { select: { status: true } },
        },
      }),
      prisma.codeReview.findMany({
        where: {
          userId,
          repositoryId,
          ...(reviewCreatedAt ? { createdAt: reviewCreatedAt } : {}),
        },
        select: {
          id: true,
          createdAt: true,
          analytics: { select: { qualityScore: true } },
        },
      }),
    ]);

    return {
      findings: findings.map((finding) => ({
        ...finding,
        assessments: finding.assessmentFeedback.map((assessment) => ({
          id: assessment.id,
          findingId: assessment.findingId,
          category: assessment.category,
          createdAt: assessment.createdAt,
        })),
        verificationStatuses: finding.verificationRecords
          .map((record) => record.status)
          .filter((status): status is ObjectiveVerificationStatus =>
            verificationStatuses.has(status as ObjectiveVerificationStatus)
          ),
      })),
      reviews: reviews.map((review) => ({
        id: review.id,
        createdAt: review.createdAt,
        qualityScore: review.analytics?.qualityScore ?? null,
      })),
    };
  },
};

export class FeedbackAnalyticsService {
  constructor(private readonly store: FeedbackAnalyticsStore = prismaFeedbackAnalyticsStore) {}

  async get(userId: string, input: unknown) {
    const filter = parseReviewAnalyticsFilter(input);
    if (!filter.repositoryId) {
      throw new ReviewAnalyticsFilterError('A repository is required.');
    }
    if (!(await this.store.ownsRepository(userId, filter.repositoryId))) {
      throw new FeedbackAnalyticsRepositoryNotFoundError();
    }
    const dataset = await this.store.read(userId, filter);
    return summarizeFeedbackAnalytics(filter, dataset);
  }
}

export { ReviewAnalyticsFilterError };
