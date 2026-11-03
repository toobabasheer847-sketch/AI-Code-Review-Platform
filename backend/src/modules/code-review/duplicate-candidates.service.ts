import { prisma } from '@/config/database';
import {
  findCrossReviewDuplicateCandidates,
  type DuplicateCandidate,
  type DuplicateSubject,
  type DuplicateUserAssessment,
} from './duplicate-candidates';

const assessmentCategories = new Set<DuplicateUserAssessment>([
  'TRUE_POSITIVE',
  'FALSE_POSITIVE',
  'ALREADY_FIXED',
  'NEEDS_REVIEW',
]);

export class DuplicateCandidateReviewNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Review not found');
    this.name = 'DuplicateCandidateReviewNotFoundError';
  }
}

export interface DuplicateCandidateStore {
  loadReview(
    userId: string,
    reviewId: string
  ): Promise<{ repositoryId: string; findings: DuplicateSubject[] } | null>;
  loadOtherFindings(
    userId: string,
    repositoryId: string,
    reviewId: string
  ): Promise<DuplicateSubject[]>;
}

function latestAssessment(
  assessments: Array<{ category: string; createdAt: Date }>
): DuplicateUserAssessment | null {
  const ordered = assessments
    .slice()
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const category = ordered[0]?.category;
  return category && assessmentCategories.has(category as DuplicateUserAssessment)
    ? (category as DuplicateUserAssessment)
    : null;
}

function toSubject(finding: {
  id: string;
  reviewId: string;
  file: string;
  line: number;
  endLine: number | null;
  category: string;
  title: string | null;
  message: string;
  evidence: string | null;
  createdAt: Date;
  assessmentFeedback: Array<{ category: string; createdAt: Date }>;
}): DuplicateSubject {
  return {
    id: finding.id,
    reviewId: finding.reviewId,
    file: finding.file,
    line: finding.line,
    endLine: finding.endLine,
    category: finding.category,
    title: finding.title,
    message: finding.message,
    evidence: finding.evidence,
    createdAt: finding.createdAt,
    userAssessment: latestAssessment(finding.assessmentFeedback),
  };
}

const findingSelect = {
  id: true,
  reviewId: true,
  file: true,
  line: true,
  endLine: true,
  category: true,
  title: true,
  message: true,
  evidence: true,
  createdAt: true,
  assessmentFeedback: { select: { category: true, createdAt: true } },
} as const;

const prismaDuplicateCandidateStore: DuplicateCandidateStore = {
  async loadReview(userId, reviewId) {
    const review = await prisma.codeReview.findFirst({
      where: { id: reviewId, userId },
      select: {
        repositoryId: true,
        findings: { select: findingSelect },
      },
    });
    if (!review) return null;
    return {
      repositoryId: review.repositoryId,
      findings: review.findings.map(toSubject),
    };
  },

  async loadOtherFindings(userId, repositoryId, reviewId) {
    const findings = await prisma.finding.findMany({
      where: {
        reviewId: { not: reviewId },
        review: { is: { userId, repositoryId } },
      },
      select: findingSelect,
    });
    return findings.map(toSubject);
  },
};

export interface DuplicateCandidateReport {
  candidates: DuplicateCandidate[];
  retainedFindingCount: number;
  removedFindingIds: string[];
}

export class DuplicateCandidateService {
  constructor(private readonly store: DuplicateCandidateStore = prismaDuplicateCandidateStore) {}

  async listForReview(userId: string, reviewId: string): Promise<DuplicateCandidateReport> {
    const review = await this.store.loadReview(userId, reviewId);
    if (!review) throw new DuplicateCandidateReviewNotFoundError();
    const prior = await this.store.loadOtherFindings(userId, review.repositoryId, reviewId);
    return {
      candidates: findCrossReviewDuplicateCandidates(review.findings, prior),
      retainedFindingCount: review.findings.length,
      removedFindingIds: [],
    };
  }
}
