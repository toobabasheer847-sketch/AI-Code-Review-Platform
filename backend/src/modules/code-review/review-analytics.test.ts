import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import {
  parseReviewAnalyticsFilter,
  ReviewAnalyticsFilterError,
  summarizeReviewAnalytics,
  type ReviewAnalyticsSnapshot,
} from './review-analytics.domain';
import {
  ReviewAnalyticsRepositoryNotFoundError,
  ReviewAnalyticsService,
  type ReviewAnalyticsStore,
} from './review-analytics.service';
import { ReviewAnalyticsController } from './review-analytics.controller';

const snapshot: ReviewAnalyticsSnapshot = {
  reviewTotal: 3,
  reviewsByStatus: { completed: 2, failed: 1 },
  findingsBySeverity: { error: 2, warning: 3, info: 1 },
  findingsByStatus: {
    UNREVIEWED: 2,
    CONFIRMED: 1,
    FALSE_POSITIVE: 1,
    FIXED: 1,
    DUPLICATE: 1,
  },
  verificationsByStatus: {
    AI_REPORTED: 4,
    VERIFIED: 1,
    VERIFICATION_FAILED: 1,
    INCONCLUSIVE: 2,
  },
  pullRequestDeliveriesByStatus: { completed: 1, stale: 1, 'publish-failed': 1 },
};

function createResponse() {
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

test('summarizes persisted findings and leaves unrecorded outcomes absent', () => {
  const result = summarizeReviewAnalytics({}, snapshot);
  assert.deepEqual(result.reviews, {
    total: 3,
    byStatus: { completed: 2, failed: 1 },
  });
  assert.deepEqual(result.findings, {
    total: 6,
    bySeverity: { error: 2, warning: 3, info: 1 },
    byStatus: snapshot.findingsByStatus,
    outcomes: {
      confirmed: 1,
      dismissed: 1,
      unresolved: 2,
      fixed: 1,
      duplicate: 1,
      wontFix: 0,
    },
  });
  assert.deepEqual(result.verifications, {
    byStatus: snapshot.verificationsByStatus,
    aiReported: 4,
    verified: 1,
    failed: 1,
    inconclusive: 2,
  });
  assert.deepEqual(result.pullRequestReviews, {
    totalDeliveries: 3,
    publicationsByStatus: snapshot.pullRequestDeliveriesByStatus,
    ciCheckResultsAvailable: false,
  });
});

test('returns real empty-dataset values without invented success metrics', () => {
  const empty: ReviewAnalyticsSnapshot = {
    reviewTotal: 0,
    reviewsByStatus: {},
    findingsBySeverity: {},
    findingsByStatus: {},
    verificationsByStatus: {},
    pullRequestDeliveriesByStatus: {},
  };
  const result = summarizeReviewAnalytics({}, empty);
  assert.equal(result.reviews.total, 0);
  assert.equal(result.findings.total, 0);
  assert.equal(result.verifications.verified, 0);
  assert.equal(result.pullRequestReviews.totalDeliveries, 0);
  assert.equal(result.pullRequestReviews.ciCheckResultsAvailable, false);
});

test('parses inclusive calendar date filters and rejects invalid ranges', () => {
  assert.deepEqual(
    parseReviewAnalyticsFilter({
      from: '2026-10-01',
      to: '2026-10-31',
      repositoryId: 'repo-1',
    }),
    {
      from: new Date('2026-10-01T00:00:00.000Z'),
      toExclusive: new Date('2026-11-01T00:00:00.000Z'),
      repositoryId: 'repo-1',
    }
  );
  assert.throws(
    () => parseReviewAnalyticsFilter({ from: '2026-02-30' }),
    ReviewAnalyticsFilterError
  );
  assert.throws(
    () => parseReviewAnalyticsFilter({ from: '2026-11-01', to: '2026-10-31' }),
    /from date must not be later/
  );
  assert.throws(() => parseReviewAnalyticsFilter({ unknown: 'value' }), ReviewAnalyticsFilterError);
});

test('scopes repository filters to the authenticated owner and applies date filters', async () => {
  const reads: Array<{ userId: string; repositoryId?: string; from?: Date; toExclusive?: Date }> =
    [];
  const store: ReviewAnalyticsStore = {
    async ownsRepository(userId, repositoryId) {
      return userId === 'owner-1' && repositoryId === 'repo-1';
    },
    async readSnapshot(userId, filter) {
      reads.push({
        userId,
        repositoryId: filter.repositoryId,
        from: filter.from,
        toExclusive: filter.toExclusive,
      });
      return snapshot;
    },
  };
  const service = new ReviewAnalyticsService(store);
  const result = await service.get('owner-1', {
    from: '2026-10-01',
    to: '2026-10-31',
    repositoryId: 'repo-1',
  });
  assert.equal(result.filters.repositoryId, 'repo-1');
  assert.deepEqual(reads, [
    {
      userId: 'owner-1',
      repositoryId: 'repo-1',
      from: new Date('2026-10-01T00:00:00.000Z'),
      toExclusive: new Date('2026-11-01T00:00:00.000Z'),
    },
  ]);

  await assert.rejects(
    service.get('other-user', { repositoryId: 'repo-1' }),
    ReviewAnalyticsRepositoryNotFoundError
  );
  assert.equal(reads.length, 1);
});

test('analytics controller requires authentication and returns service failures', async () => {
  let calls = 0;
  const controller = new ReviewAnalyticsController({
    async get(userId, query) {
      calls += 1;
      assert.equal(userId, 'owner-1');
      assert.deepEqual(query, { from: '2026-10-01' });
      throw new ReviewAnalyticsFilterError('Invalid analytics filters.');
    },
  });
  const unauthorized = createResponse();
  await controller.get({ query: {} } as Request, unauthorized.response);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(calls, 0);

  const invalid = createResponse();
  await controller.get(
    { user: { userId: 'owner-1' }, query: { from: '2026-10-01' } } as Request,
    invalid.response
  );
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.body, { error: 'Invalid analytics filters.' });
});
