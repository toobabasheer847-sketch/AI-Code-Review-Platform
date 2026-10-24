import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canTransitionFindingStatus,
  summarizeFindingLifecycle,
  updateFindingStatusSchema,
  type FindingStatusValue,
} from './finding-lifecycle.domain';
import {
  FindingLifecycleService,
  FindingNotFoundError,
  InvalidFindingTransitionError,
  type FindingFeedbackRecord,
  type FindingLifecycleStore,
} from './finding-lifecycle.service';

const statuses: FindingStatusValue[] = [
  'UNREVIEWED',
  'CONFIRMED',
  'FALSE_POSITIVE',
  'DUPLICATE',
  'FIXED',
  'WONT_FIX',
];

test('accepts only declared lifecycle transitions and rejects unchanged or skipped states', () => {
  assert.equal(canTransitionFindingStatus('UNREVIEWED', 'CONFIRMED'), true);
  assert.equal(canTransitionFindingStatus('CONFIRMED', 'FIXED'), true);
  assert.equal(canTransitionFindingStatus('FIXED', 'UNREVIEWED'), true);
  assert.equal(canTransitionFindingStatus('UNREVIEWED', 'UNREVIEWED'), false);
  assert.equal(canTransitionFindingStatus('FALSE_POSITIVE', 'FIXED'), false);
});

test('validates lifecycle update input and treats blank optional reasons as omitted', () => {
  assert.deepEqual(
    updateFindingStatusSchema.parse({ status: 'FALSE_POSITIVE', reason: '  Not reproducible  ' }),
    { status: 'FALSE_POSITIVE', reason: 'Not reproducible' }
  );
  assert.deepEqual(updateFindingStatusSchema.parse({ status: 'FIXED', reason: '   ' }), {
    status: 'FIXED',
  });
  assert.equal(updateFindingStatusSchema.safeParse({ status: 'UNKNOWN' }).success, false);
  assert.equal(
    updateFindingStatusSchema.safeParse({ status: 'FIXED', reason: 'x'.repeat(1_001) }).success,
    false
  );
  assert.equal(
    updateFindingStatusSchema.safeParse({ status: 'FIXED', extra: true }).success,
    false
  );
  assert.equal(
    updateFindingStatusSchema.safeParse({ status: 'FIXED', verificationStatus: 'VERIFIED' })
      .success,
    false
  );
  assert.equal(
    updateFindingStatusSchema.safeParse({
      status: 'FIXED',
      independentlyVerifiedAt: new Date().toISOString(),
    }).success,
    false
  );
});

test('persists status change, optional reason, timestamp, and acting user in feedback history', async () => {
  let currentStatus: FindingStatusValue = 'UNREVIEWED';
  const history: FindingFeedbackRecord[] = [];
  const store: FindingLifecycleStore = {
    async findOwnedFinding(userId, findingId) {
      assert.equal(userId, 'owner-1');
      assert.equal(findingId, 'finding-1');
      return { id: findingId, status: currentStatus, independentlyVerifiedAt: null };
    },
    async persistStatusChange(input) {
      assert.deepEqual(input, {
        userId: 'owner-1',
        findingId: 'finding-1',
        previousStatus: 'UNREVIEWED',
        status: 'FALSE_POSITIVE',
        reason: 'Does not apply to this call path',
      });
      currentStatus = input.status;
      const feedback: FindingFeedbackRecord = {
        id: 'feedback-1',
        findingId: input.findingId,
        userId: input.userId,
        previousStatus: input.previousStatus,
        status: input.status,
        reason: input.reason,
        createdAt: new Date('2026-10-21T12:00:00.000Z'),
        user: { fullName: 'Code Reviewer' },
      };
      history.push(feedback);
      return feedback;
    },
  };

  const service = new FindingLifecycleService(store);
  const feedback = await service.updateStatus(
    'owner-1',
    'finding-1',
    'FALSE_POSITIVE',
    'Does not apply to this call path'
  );

  assert.equal(currentStatus, 'FALSE_POSITIVE');
  assert.deepEqual(history, [feedback]);
  assert.equal(feedback.userId, 'owner-1');
  assert.equal(feedback.createdAt.toISOString(), '2026-10-21T12:00:00.000Z');
  assert.equal(feedback.reason, 'Does not apply to this call path');
});

test('rejects another user’s finding and disallowed transitions without writing feedback', async () => {
  let writes = 0;
  const store: FindingLifecycleStore = {
    async findOwnedFinding() {
      return null;
    },
    async persistStatusChange() {
      writes += 1;
      throw new Error('Should not persist');
    },
  };
  const service = new FindingLifecycleService(store);

  await assert.rejects(
    service.updateStatus('another-user', 'finding-1', 'FIXED'),
    FindingNotFoundError
  );
  assert.equal(writes, 0);

  const falsePositiveService = new FindingLifecycleService({
    ...store,
    async findOwnedFinding() {
      return { id: 'finding-1', status: 'FALSE_POSITIVE', independentlyVerifiedAt: null };
    },
  });
  await assert.rejects(
    falsePositiveService.updateStatus('owner-1', 'finding-1', 'FIXED'),
    InvalidFindingTransitionError
  );
  assert.equal(writes, 0);
});

test('analytics count persisted statuses and separate developer-marked from verified fixes', () => {
  const summary = summarizeFindingLifecycle([
    { status: 'UNREVIEWED', independentlyVerifiedAt: null },
    { status: 'FIXED', independentlyVerifiedAt: null },
    { status: 'FIXED', independentlyVerifiedAt: new Date('2026-10-20T10:00:00.000Z') },
    { status: 'FALSE_POSITIVE', independentlyVerifiedAt: null },
  ]);

  assert.equal(summary.total, 4);
  assert.deepEqual(summary.statusCounts, {
    UNREVIEWED: 1,
    CONFIRMED: 0,
    FALSE_POSITIVE: 1,
    DUPLICATE: 0,
    FIXED: 2,
    WONT_FIX: 0,
  });
  assert.equal(summary.developerMarkedFixed, 2);
  assert.equal(summary.independentlyVerifiedFixed, 1);
  assert.deepEqual(
    summarizeFindingLifecycle(statuses.map((status) => ({ status, independentlyVerifiedAt: null })))
      .statusCounts,
    Object.fromEntries(statuses.map((status) => [status, 1]))
  );
});
