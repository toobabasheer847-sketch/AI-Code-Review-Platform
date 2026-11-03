import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import {
  summarizeFeedbackAnalytics,
  type FeedbackAnalyticsDataset,
  type FeedbackAnalyticsFinding,
} from './feedback-analytics.domain';
import { FeedbackAnalyticsController } from './feedback-analytics.controller';
import {
  FeedbackAnalyticsRepositoryNotFoundError,
  FeedbackAnalyticsService,
  type FeedbackAnalyticsStore,
} from './feedback-analytics.service';
import { ReviewAnalyticsFilterError } from './review-analytics.domain';

function finding(overrides: Partial<FeedbackAnalyticsFinding> = {}): FeedbackAnalyticsFinding {
  return {
    id: 'finding-1',
    reviewId: 'review-1',
    file: 'src/app.ts',
    line: 4,
    endLine: 4,
    severity: 'warning',
    category: 'bug',
    title: 'Unchecked return',
    message: 'The return value is ignored.',
    evidence: 'return value',
    createdAt: new Date('2026-10-15T00:00:00.000Z'),
    independentlyVerifiedAt: null,
    verificationStatuses: ['AI_REPORTED'],
    assessments: [],
    ...overrides,
  };
}

function responseDouble() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      body = value;
      return response;
    },
  };
  return {
    response: response as unknown as Response,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

test('does not treat unreviewed or AI-reported findings as confirmed true or false positives', () => {
  const dataset: FeedbackAnalyticsDataset = {
    reviews: [{ id: 'review-1', createdAt: new Date('2026-10-15T00:00:00.000Z'), qualityScore: 80 }],
    findings: [
      finding({ id: 'unreviewed', verificationStatuses: ['AI_REPORTED'] }),
      finding({
        id: 'failed-check',
        verificationStatuses: ['VERIFICATION_FAILED'],
        category: 'security',
      }),
      finding({
        id: 'verified-fix',
        independentlyVerifiedAt: new Date('2026-10-16T00:00:00.000Z'),
        verificationStatuses: ['INCONCLUSIVE'],
      }),
    ],
  };
  const result = summarizeFeedbackAnalytics({}, dataset);
  assert.equal(result.findings.total, 3);
  assert.equal(result.findings.unassessed, 3);
  assert.equal(result.findings.userAssessedTruePositives, 0);
  assert.equal(result.findings.userAssessedFalsePositives, 0);
  assert.equal(result.objectiveVerification.verified, 0);
  assert.equal(result.objectiveVerification.aiReportedOnly, 1);
  assert.equal(result.objectiveVerification.verificationFailed, 1);
  assert.equal(result.objectiveVerification.inconclusive, 1);
  assert.equal(result.objectiveVerification.independentlyVerifiedFixes, 1);
  assert.equal(result.objectiveVerification.unreviewedAiFindingsAreConfirmed, false);
  assert.equal(result.rates, null);
  assert.match(result.ratesWithheldReason ?? '', /withheld/);
});

test('keeps user assessments distinct from objective verification and withholds small-sample rates', () => {
  const result = summarizeFeedbackAnalytics(
    {},
    {
      reviews: [],
      findings: [
        finding({
          id: 'disputed',
          category: 'security',
          severity: 'error',
          verificationStatuses: ['VERIFIED'],
          assessments: [
            {
              id: 'assessment-1',
              findingId: 'disputed',
              category: 'FALSE_POSITIVE',
              createdAt: new Date('2026-10-16T00:00:00.000Z'),
            },
          ],
        }),
      ],
    }
  );
  assert.equal(result.findings.userAssessedFalsePositives, 1);
  assert.equal(result.findings.userAssessedTruePositives, 0);
  assert.equal(result.objectiveVerification.verified, 1);
  assert.equal(result.rates, null);
  assert.match(result.ratesWithheldReason ?? '', /only 1 finding has user assessments/);
});

test('uses the latest in-range assessment, exact rate denominators, and assessment-event trends', () => {
  const findings = [
    finding({
      id: 'true-positive',
      severity: 'error',
      category: 'security',
      assessments: [
        {
          id: 'old-false',
          findingId: 'true-positive',
          category: 'FALSE_POSITIVE',
          createdAt: new Date('2026-10-02T00:00:00.000Z'),
        },
        {
          id: 'new-true',
          findingId: 'true-positive',
          category: 'TRUE_POSITIVE',
          createdAt: new Date('2026-10-20T00:00:00.000Z'),
        },
      ],
    }),
    finding({
      id: 'second-true',
      category: 'bug',
      assessments: [
        {
          id: 'true-2',
          findingId: 'second-true',
          category: 'TRUE_POSITIVE',
          createdAt: new Date('2026-10-03T00:00:00.000Z'),
        },
      ],
    }),
    finding({
      id: 'false-positive',
      category: 'quality',
      assessments: [
        {
          id: 'false-1',
          findingId: 'false-positive',
          category: 'FALSE_POSITIVE',
          createdAt: new Date('2026-10-04T00:00:00.000Z'),
        },
      ],
    }),
    finding({
      id: 'fixed',
      reviewId: 'review-2',
      assessments: [
        {
          id: 'fixed-1',
          findingId: 'fixed',
          category: 'ALREADY_FIXED',
          createdAt: new Date('2026-10-05T00:00:00.000Z'),
        },
      ],
    }),
    finding({
      id: 'needs-review',
      reviewId: 'review-2',
      assessments: [
        {
          id: 'needs-1',
          findingId: 'needs-review',
          category: 'NEEDS_REVIEW',
          createdAt: new Date('2026-10-06T00:00:00.000Z'),
        },
      ],
    }),
    finding({ id: 'still-open' }),
    finding({ id: 'november', createdAt: new Date('2026-11-02T00:00:00.000Z') }),
  ];
  const reviews = [
    { id: 'review-1', createdAt: new Date('2026-10-01T00:00:00.000Z'), qualityScore: 70 },
    { id: 'review-2', createdAt: new Date('2026-10-04T00:00:00.000Z'), qualityScore: null },
  ];
  const filtered = summarizeFeedbackAnalytics(
    {
      from: new Date('2026-10-01T00:00:00.000Z'),
      toExclusive: new Date('2026-11-01T00:00:00.000Z'),
      repositoryId: 'repo-1',
    },
    { findings, reviews }
  );

  assert.equal(filtered.findings.total, 6);
  assert.equal(filtered.findings.userAssessedTruePositives, 2);
  assert.equal(filtered.findings.userAssessedFalsePositives, 1);
  assert.equal(filtered.findings.alreadyFixed, 1);
  assert.equal(filtered.findings.needsReview, 1);
  assert.equal(filtered.findings.unassessed, 1);
  assert.equal(
    filtered.findings.userAssessedTruePositives +
      filtered.findings.userAssessedFalsePositives +
      filtered.findings.alreadyFixed +
      filtered.findings.needsReview +
      filtered.findings.unassessed,
    filtered.findings.total
  );
  assert.equal(filtered.rates?.denominator, 'userAssessedFindings');
  assert.equal(filtered.rates?.sampleSize, 5);
  assert.equal(filtered.rates?.truePositive, 2 / 5);
  assert.equal(filtered.rates?.falsePositive, 1 / 5);
  assert.deepEqual(filtered.trends.points, [
    { date: '2026-10-02', truePositive: 0, falsePositive: 1, alreadyFixed: 0, needsReview: 0 },
    { date: '2026-10-03', truePositive: 1, falsePositive: 0, alreadyFixed: 0, needsReview: 0 },
    { date: '2026-10-04', truePositive: 0, falsePositive: 1, alreadyFixed: 0, needsReview: 0 },
    { date: '2026-10-05', truePositive: 0, falsePositive: 0, alreadyFixed: 1, needsReview: 0 },
    { date: '2026-10-06', truePositive: 0, falsePositive: 0, alreadyFixed: 0, needsReview: 1 },
    { date: '2026-10-20', truePositive: 1, falsePositive: 0, alreadyFixed: 0, needsReview: 0 },
  ]);
  assert.equal(filtered.distributionBySeverity.find((row) => row.key === 'warning')?.total, 5);
  assert.equal(filtered.distributionByCategory.find((row) => row.key === 'security')?.truePositive, 1);
  assert.equal(filtered.reviewTrends[0]?.qualityScore, 70);
  assert.equal(filtered.reviewTrends[0]?.rates, null);
  assert.equal(filtered.repositoryTrend.qualityScoreAverage, null);
  assert.match(filtered.repositoryTrend.qualityScoreAverageWithheldReason ?? '', /withheld/);

  const unfiltered = summarizeFeedbackAnalytics({}, { findings, reviews });
  assert.equal(unfiltered.findings.total, 7);
});

test('classifies a finding by the latest assessment inside the selected dates', () => {
  const dataset: FeedbackAnalyticsDataset = {
    reviews: [],
    findings: [
      finding({
        assessments: [
          {
            id: 'october',
            findingId: 'finding-1',
            category: 'FALSE_POSITIVE',
            createdAt: new Date('2026-10-16T00:00:00.000Z'),
          },
          {
            id: 'november',
            findingId: 'finding-1',
            category: 'TRUE_POSITIVE',
            createdAt: new Date('2026-11-05T00:00:00.000Z'),
          },
        ],
      }),
    ],
  };
  const october = summarizeFeedbackAnalytics(
    {
      from: new Date('2026-10-01T00:00:00.000Z'),
      toExclusive: new Date('2026-11-01T00:00:00.000Z'),
    },
    dataset
  );
  assert.equal(october.findings.userAssessedFalsePositives, 1);
  assert.equal(october.findings.userAssessedTruePositives, 0);
  assert.equal(october.trends.points.length, 1);

  const allTime = summarizeFeedbackAnalytics({}, dataset);
  assert.equal(allTime.findings.userAssessedTruePositives, 1);
  assert.equal(allTime.findings.userAssessedFalsePositives, 0);
});

test('suggests rule improvements without applying them, including security false positives', () => {
  const findings = ['quality', 'quality', 'quality', 'security', 'security', 'security'].map(
    (category, index) =>
      finding({
        id: `finding-${index}`,
        category,
        file: `src/${category}-${index}.ts`,
        assessments: [
          {
            id: `assessment-${index}`,
            findingId: `finding-${index}`,
            category: 'FALSE_POSITIVE',
            createdAt: new Date('2026-10-10T00:00:00.000Z'),
          },
        ],
      })
  );
  const result = summarizeFeedbackAnalytics({}, { findings, reviews: [] });
  assert.equal(result.ruleSuggestions.length, 2);
  assert.deepEqual(
    result.ruleSuggestions.map((suggestion) => suggestion.autoApplied),
    [false, false]
  );
  assert.match(
    result.ruleSuggestions.find((suggestion) => suggestion.category === 'security')?.message ?? '',
    /does not create rules or suppress security findings/
  );
});

test('returns cross-review duplicate candidates without removing findings', () => {
  const result = summarizeFeedbackAnalytics(
    {},
    {
      reviews: [],
      findings: [
        finding({
          id: 'older',
          reviewId: 'review-1',
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
          category: 'security',
          assessments: [
            {
              id: 'older-feedback',
              findingId: 'older',
              category: 'FALSE_POSITIVE',
              createdAt: new Date('2026-10-02T00:00:00.000Z'),
            },
          ],
        }),
        finding({
          id: 'newer',
          reviewId: 'review-2',
          createdAt: new Date('2026-10-03T00:00:00.000Z'),
          category: 'security',
        }),
      ],
    }
  );
  assert.equal(result.findings.total, 2);
  assert.equal(result.duplicateCandidates.length, 1);
  assert.equal(result.duplicateCandidates[0]?.findingId, 'newer');
  assert.equal(result.duplicateCandidates[0]?.matchedFindingId, 'older');
  assert.equal(result.duplicateCandidates[0]?.suppressed, false);
  assert.equal(result.duplicateCandidates[0]?.requiresHumanReview, true);
  assert.equal(result.duplicateCandidates[0]?.priorUserAssessment, 'FALSE_POSITIVE');
});

test('scopes feedback analytics to the repository owner and applies date filters', async () => {
  const reads: Array<{ userId: string; repositoryId?: string; from?: Date }> = [];
  const store: FeedbackAnalyticsStore = {
    async ownsRepository(userId, repositoryId) {
      return userId === 'owner-1' && repositoryId === 'repo-1';
    },
    async read(userId, filter) {
      reads.push({ userId, repositoryId: filter.repositoryId, from: filter.from });
      return { findings: [], reviews: [] };
    },
  };
  const service = new FeedbackAnalyticsService(store);
  const result = await service.get('owner-1', {
    repositoryId: 'repo-1',
    from: '2026-10-01',
    to: '2026-10-31',
  });
  assert.equal(result.findings.total, 0);
  assert.equal(result.filters.repositoryId, 'repo-1');
  assert.equal(reads.length, 1);
  assert.equal(reads[0]?.from?.toISOString(), '2026-10-01T00:00:00.000Z');

  await assert.rejects(
    service.get('other-user', { repositoryId: 'repo-1' }),
    FeedbackAnalyticsRepositoryNotFoundError
  );
  await assert.rejects(service.get('owner-1', {}), /repository is required/);
  assert.equal(reads.length, 1);
});

test('feedback analytics controller requires authentication and reports invalid filters', async () => {
  const controller = new FeedbackAnalyticsController({
    async get() {
      throw new ReviewAnalyticsFilterError('Invalid analytics filters.');
    },
  });
  const unauthorized = responseDouble();
  await controller.get({ query: {} } as Request, unauthorized.response);
  assert.equal(unauthorized.statusCode, 401);

  const invalid = responseDouble();
  await controller.get(
    { user: { userId: 'owner-1' }, query: { repositoryId: 'repo-1' } } as unknown as Request,
    invalid.response
  );
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.body, { error: 'Invalid analytics filters.' });
});
