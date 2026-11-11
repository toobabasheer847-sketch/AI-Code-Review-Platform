import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findCrossReviewDuplicateCandidates,
  type DuplicateSubject,
} from './duplicate-candidates';
import {
  DuplicateCandidateReviewNotFoundError,
  DuplicateCandidateService,
  duplicateCandidateScanLimit,
  type DuplicateCandidateStore,
} from './duplicate-candidates.service';

function subject(overrides: Partial<DuplicateSubject> = {}): DuplicateSubject {
  return {
    id: 'finding-1',
    reviewId: 'review-1',
    file: 'src/auth.ts',
    line: 8,
    category: 'security',
    title: 'Credential-like value embedded in source',
    message: 'A credential literal is present.',
    evidence: 'const token = "[REDACTED]";',
    createdAt: new Date('2026-10-02T00:00:00.000Z'),
    userAssessment: null,
    ...overrides,
  };
}

test('returns cross-review candidates and leaves every finding in place', () => {
  const current = [
    subject({ id: 'current-security', reviewId: 'review-2' }),
    subject({
      id: 'current-distinct',
      reviewId: 'review-2',
      file: 'src/other.ts',
      title: 'Different issue title',
      evidence: 'other evidence',
    }),
  ];
  const prior = [
    subject({
      id: 'prior-security',
      reviewId: 'review-1',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      userAssessment: 'FALSE_POSITIVE',
    }),
  ];
  const before = current.length;
  const candidates = findCrossReviewDuplicateCandidates(current, prior);

  assert.equal(current.length, before);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.findingId, 'current-security');
  assert.equal(candidates[0]?.matchedFindingId, 'prior-security');
  assert.equal(candidates[0]?.category, 'security');
  assert.equal(candidates[0]?.suppressed, false);
  assert.equal(candidates[0]?.requiresHumanReview, true);
  assert.match(candidates[0]?.reason ?? '', /not deleted or suppressed/);
});

test('duplicate candidate lookup is owner-scoped and does not delete findings', async () => {
  const current = [subject({ id: 'current-security', reviewId: 'review-2' })];
  let otherReads = 0;
  const store: DuplicateCandidateStore = {
    async loadReview(userId, reviewId) {
      if (userId !== 'owner-1' || reviewId !== 'review-2') return null;
      return { repositoryId: 'repo-1', findings: current };
    },
    async loadOtherFindings(userId, repositoryId, reviewId) {
      otherReads += 1;
      assert.equal(userId, 'owner-1');
      assert.equal(repositoryId, 'repo-1');
      assert.equal(reviewId, 'review-2');
      return [
        subject({
          id: 'prior-security',
          userAssessment: 'FALSE_POSITIVE',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
      ];
    },
  };
  const service = new DuplicateCandidateService(store);
  const report = await service.listForReview('owner-1', 'review-2');
  assert.equal(report.retainedFindingCount, 1);
  assert.deepEqual(report.removedFindingIds, []);
  assert.equal(report.candidates[0]?.suppressed, false);
  assert.equal(report.candidates[0]?.category, 'security');
  assert.equal(otherReads, 1);

  await assert.rejects(
    service.listForReview('other-user', 'review-2'),
    DuplicateCandidateReviewNotFoundError
  );
  assert.equal(otherReads, 1);
  assert.equal(current.length, 1);
});

test('duplicate scans stay bounded to the newest findings in the repository', () => {
  assert.equal(duplicateCandidateScanLimit, 200);
});
