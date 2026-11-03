import type { ReviewAnalyticsFilter } from './review-analytics.domain';
import {
  findRepositoryDuplicateCandidates,
  type DuplicateCandidate,
  type DuplicateSubject,
  type DuplicateUserAssessment,
} from './duplicate-candidates';

export const MIN_FEEDBACK_RATE_SAMPLE = 5;

export const feedbackAnalyticsDistinctions = {
  userAssessments:
    'Counts come from saved finding assessment feedback. They are developer judgments, not objective ground truth.',
  objectiveVerification:
    'Objectively verified findings are those with a verification record of VERIFIED. AI_REPORTED is an unverified model report.',
  unassessedFindings:
    'Findings without an in-range user assessment are unassessed. They are not confirmed true positives or false positives.',
  verificationFailure:
    'A failed or inconclusive verification is not a confirmed false positive.',
  verifiedFix:
    'An independently verified fix is recorded separately and is not labeled a true positive.',
  duplicateCandidates:
    'Cross-review duplicate detection returns candidates for human review and does not delete findings.',
} as const;

export type FeedbackAssessmentCategory = DuplicateUserAssessment;

export type ObjectiveVerificationStatus =
  | 'AI_REPORTED'
  | 'VERIFIED'
  | 'VERIFICATION_FAILED'
  | 'INCONCLUSIVE';

export interface FeedbackAnalyticsAssessment {
  id: string;
  findingId: string;
  category: FeedbackAssessmentCategory;
  createdAt: Date;
}

export interface FeedbackAnalyticsFinding {
  id: string;
  reviewId: string;
  file: string;
  line: number;
  endLine: number | null;
  severity: string;
  category: string;
  title: string | null;
  message: string;
  evidence: string | null;
  createdAt: Date;
  independentlyVerifiedAt: Date | null;
  verificationStatuses: ObjectiveVerificationStatus[];
  assessments: FeedbackAnalyticsAssessment[];
}

export interface FeedbackAnalyticsReview {
  id: string;
  createdAt: Date;
  qualityScore: number | null;
}

export interface FeedbackAnalyticsDataset {
  findings: FeedbackAnalyticsFinding[];
  reviews: FeedbackAnalyticsReview[];
}

export interface FeedbackAssessmentCounts {
  truePositive: number;
  falsePositive: number;
  alreadyFixed: number;
  needsReview: number;
  unassessed: number;
}

export interface FeedbackRates {
  denominator: 'userAssessedFindings';
  sampleSize: number;
  minimumSampleSize: number;
  truePositive: number;
  falsePositive: number;
  alreadyFixed: number;
  needsReview: number;
}

export interface RuleSuggestion {
  category: string;
  message: string;
  autoApplied: false;
}

interface DistributionRow extends FeedbackAssessmentCounts {
  key: string;
  total: number;
}

function inWindow(date: Date, filter: ReviewAnalyticsFilter): boolean {
  if (filter.from && date < filter.from) return false;
  if (filter.toExclusive && date >= filter.toExclusive) return false;
  return true;
}

function emptyCounts(): FeedbackAssessmentCounts {
  return {
    truePositive: 0,
    falsePositive: 0,
    alreadyFixed: 0,
    needsReview: 0,
    unassessed: 0,
  };
}

export function assessmentRates(counts: FeedbackAssessmentCounts): {
  rates: FeedbackRates | null;
  ratesWithheldReason: string | null;
} {
  const sampleSize =
    counts.truePositive + counts.falsePositive + counts.alreadyFixed + counts.needsReview;
  if (sampleSize < MIN_FEEDBACK_RATE_SAMPLE) {
    const noun = sampleSize === 1 ? 'finding has' : 'findings have';
    return {
      rates: null,
      ratesWithheldReason: `Percentages are withheld because only ${sampleSize} ${noun} user assessments. At least ${MIN_FEEDBACK_RATE_SAMPLE} assessed findings are required.`,
    };
  }
  return {
    rates: {
      denominator: 'userAssessedFindings',
      sampleSize,
      minimumSampleSize: MIN_FEEDBACK_RATE_SAMPLE,
      truePositive: counts.truePositive / sampleSize,
      falsePositive: counts.falsePositive / sampleSize,
      alreadyFixed: counts.alreadyFixed / sampleSize,
      needsReview: counts.needsReview / sampleSize,
    },
    ratesWithheldReason: null,
  };
}

function latestAssessment(
  assessments: FeedbackAnalyticsAssessment[],
  filter: ReviewAnalyticsFilter
): FeedbackAnalyticsAssessment | null {
  const eligible = assessments.filter((assessment) => inWindow(assessment.createdAt, filter));
  eligible.sort((left, right) => {
    const time = right.createdAt.getTime() - left.createdAt.getTime();
    if (time !== 0) return time;
    return right.id.localeCompare(left.id);
  });
  return eligible[0] ?? null;
}

function addCategory(counts: FeedbackAssessmentCounts, category: FeedbackAssessmentCategory | null): void {
  if (category === 'TRUE_POSITIVE') counts.truePositive += 1;
  else if (category === 'FALSE_POSITIVE') counts.falsePositive += 1;
  else if (category === 'ALREADY_FIXED') counts.alreadyFixed += 1;
  else if (category === 'NEEDS_REVIEW') counts.needsReview += 1;
  else counts.unassessed += 1;
}

function objectiveBucket(
  finding: FeedbackAnalyticsFinding
): 'verified' | 'verificationFailed' | 'inconclusive' | 'aiReportedOnly' {
  if (finding.verificationStatuses.includes('VERIFIED')) return 'verified';
  if (finding.verificationStatuses.includes('VERIFICATION_FAILED')) return 'verificationFailed';
  if (finding.verificationStatuses.includes('INCONCLUSIVE')) return 'inconclusive';
  return 'aiReportedOnly';
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function suggestRules(falsePositivesByCategory: Map<string, number>): RuleSuggestion[] {
  return [...falsePositivesByCategory.entries()]
    .filter(([, count]) => count >= 3)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, count]) => ({
      category,
      autoApplied: false as const,
      message:
        category === 'security'
          ? `${count} security findings were user-assessed as false positives. Review them manually. Feedback does not create rules or suppress security findings.`
          : `${count} ${category} findings were user-assessed as false positives. You can add a repository review rule yourself if future reviews should apply that context. This suggestion is not applied automatically.`,
    }));
}

export function summarizeFeedbackAnalytics(
  filter: ReviewAnalyticsFilter,
  dataset: FeedbackAnalyticsDataset
) {
  const findings = dataset.findings.filter((finding) => inWindow(finding.createdAt, filter));
  const reviews = dataset.reviews.filter((review) => inWindow(review.createdAt, filter));
  const totals = emptyCounts();
  const objective = {
    verified: 0,
    verificationFailed: 0,
    inconclusive: 0,
    aiReportedOnly: 0,
    independentlyVerifiedFixes: 0,
  };
  const severity = new Map<string, DistributionRow>();
  const category = new Map<string, DistributionRow>();
  const trend = new Map<string, Omit<FeedbackAssessmentCounts, 'unassessed'>>();
  const falsePositivesByCategory = new Map<string, number>();
  const classified = new Map<string, FeedbackAssessmentCategory | null>();

  for (const finding of findings) {
    const assessment = latestAssessment(finding.assessments, filter);
    const assessmentCategory = assessment?.category ?? null;
    classified.set(finding.id, assessmentCategory);
    addCategory(totals, assessmentCategory);
    if (assessmentCategory === 'FALSE_POSITIVE') {
      falsePositivesByCategory.set(
        finding.category,
        (falsePositivesByCategory.get(finding.category) ?? 0) + 1
      );
    }
    objective[objectiveBucket(finding)] += 1;
    if (finding.independentlyVerifiedAt) objective.independentlyVerifiedFixes += 1;

    for (const [map, key] of [
      [severity, finding.severity],
      [category, finding.category],
    ] as const) {
      const row = map.get(key) ?? { key, total: 0, ...emptyCounts() };
      addCategory(row, assessmentCategory);
      row.total += 1;
      map.set(key, row);
    }

    for (const event of finding.assessments) {
      if (!inWindow(event.createdAt, filter)) continue;
      const point = trend.get(dayKey(event.createdAt)) ?? {
        truePositive: 0,
        falsePositive: 0,
        alreadyFixed: 0,
        needsReview: 0,
      };
      if (event.category === 'TRUE_POSITIVE') point.truePositive += 1;
      else if (event.category === 'FALSE_POSITIVE') point.falsePositive += 1;
      else if (event.category === 'ALREADY_FIXED') point.alreadyFixed += 1;
      else point.needsReview += 1;
      trend.set(dayKey(event.createdAt), point);
    }
  }

  const rateSummary = assessmentRates(totals);
  const reviewTrends = reviews
    .slice()
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .map((review) => {
      const counts = emptyCounts();
      let objectivelyVerified = 0;
      for (const finding of findings) {
        if (finding.reviewId !== review.id) continue;
        addCategory(counts, classified.get(finding.id) ?? null);
        if (objectiveBucket(finding) === 'verified') objectivelyVerified += 1;
      }
      const reviewRates = assessmentRates(counts);
      return {
        reviewId: review.id,
        createdAt: review.createdAt.toISOString(),
        qualityScore: review.qualityScore,
        totalFindings: counts.truePositive + counts.falsePositive + counts.alreadyFixed + counts.needsReview + counts.unassessed,
        userAssessedTruePositives: counts.truePositive,
        userAssessedFalsePositives: counts.falsePositive,
        alreadyFixed: counts.alreadyFixed,
        needsReview: counts.needsReview,
        unassessed: counts.unassessed,
        objectivelyVerified,
        rates: reviewRates.rates,
        ratesWithheldReason: reviewRates.ratesWithheldReason,
      };
    });

  const scoredReviews = reviews.filter(
    (review): review is FeedbackAnalyticsReview & { qualityScore: number } =>
      review.qualityScore !== null
  );
  const qualityScoreAverage =
    scoredReviews.length >= MIN_FEEDBACK_RATE_SAMPLE
      ? scoredReviews.reduce((total, review) => total + review.qualityScore, 0) / scoredReviews.length
      : null;

  const duplicateSubjects: DuplicateSubject[] = findings.map((finding) => ({
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
    userAssessment: classified.get(finding.id) ?? null,
  }));

  return {
    filters: {
      from: filter.from?.toISOString().slice(0, 10) ?? null,
      to: filter.toExclusive
        ? new Date(filter.toExclusive.getTime() - 1).toISOString().slice(0, 10)
        : null,
      repositoryId: filter.repositoryId ?? null,
    },
    distinctions: feedbackAnalyticsDistinctions,
    findings: {
      total: findings.length,
      userAssessedTruePositives: totals.truePositive,
      userAssessedFalsePositives: totals.falsePositive,
      alreadyFixed: totals.alreadyFixed,
      needsReview: totals.needsReview,
      unassessed: totals.unassessed,
    },
    rates: rateSummary.rates,
    ratesWithheldReason: rateSummary.ratesWithheldReason,
    objectiveVerification: {
      ...objective,
      unreviewedAiFindingsAreConfirmed: false,
    },
    distributionBySeverity: [...severity.values()].sort((left, right) => left.key.localeCompare(right.key)),
    distributionByCategory: [...category.values()].sort((left, right) => left.key.localeCompare(right.key)),
    trends: {
      basis: 'assessment_events' as const,
      note: 'Each saved assessment is counted on its calendar day. Finding totals use only the latest in-range assessment for each finding.',
      points: [...trend.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, counts]) => ({ date, ...counts })),
    },
    reviewTrends,
    repositoryTrend: {
      reviewCount: reviews.length,
      scoredReviewCount: scoredReviews.length,
      qualityScoreAverage,
      qualityScoreAverageWithheldReason:
        qualityScoreAverage === null
          ? `The repository quality-score average is withheld because only ${scoredReviews.length} review${scoredReviews.length === 1 ? '' : 's'} have a stored score. At least ${MIN_FEEDBACK_RATE_SAMPLE} scored reviews are required.`
          : null,
      totalFindings: findings.length,
      userAssessedTruePositives: totals.truePositive,
      userAssessedFalsePositives: totals.falsePositive,
      alreadyFixed: totals.alreadyFixed,
      needsReview: totals.needsReview,
      unassessed: totals.unassessed,
      rates: rateSummary.rates,
      ratesWithheldReason: rateSummary.ratesWithheldReason,
    },
    duplicateCandidates: findRepositoryDuplicateCandidates(duplicateSubjects) satisfies DuplicateCandidate[],
    ruleSuggestions: suggestRules(falsePositivesByCategory),
  };
}
