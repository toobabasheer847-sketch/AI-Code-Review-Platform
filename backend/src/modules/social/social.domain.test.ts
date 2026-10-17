import assert from 'node:assert/strict';
import test from 'node:test';
import { SocialPostStatus, SocialProvider } from '@prisma/client';
import {
  canClaimSocialPublication,
  createSocialApprovalPayload,
  hashSocialApprovalPayload,
  isSocialApprovalIntact,
  LINKEDIN_POST_MAX_CHARACTERS,
  ownedSocialPostWhere,
  validateLinkedInContent,
  validateScheduleDate,
} from './social.domain';

const payload = {
  postId: 'post-1',
  platform: SocialProvider.LINKEDIN,
  accountId: 'account-1',
  platformAccountId: 'linkedin-member-1',
  destinationLabel: 'Alex Member',
  content: 'An evidence-backed project update.',
  scheduledAt: '2026-10-17T12:00:00.000Z',
};

test('LinkedIn draft validation enforces the platform text boundary and normalizes whitespace', () => {
  assert.equal(validateLinkedInContent('  hello\n'), 'hello');
  assert.equal(
    validateLinkedInContent('x'.repeat(LINKEDIN_POST_MAX_CHARACTERS)),
    'x'.repeat(LINKEDIN_POST_MAX_CHARACTERS)
  );
  assert.throws(() => validateLinkedInContent('  '), /required/);
  assert.throws(() => validateLinkedInContent('x'.repeat(LINKEDIN_POST_MAX_CHARACTERS + 1)), /3000/);
});

test('schedule date rejects past, too-soon, and over-30-day publishing requests', () => {
  const now = new Date('2026-10-16T12:00:00.000Z');
  assert.doesNotThrow(() => validateScheduleDate(null, now));
  assert.doesNotThrow(() => validateScheduleDate(new Date('2026-10-16T12:01:00.000Z'), now));
  assert.throws(() => validateScheduleDate(new Date('2026-10-16T12:00:59.999Z'), now), /one minute/);
  assert.throws(() => validateScheduleDate(new Date('2026-11-16T12:00:00.001Z'), now), /30 days/);
});

test('approval fingerprint binds content, account, platform destination, and schedule', () => {
  const base = createSocialApprovalPayload(payload);
  const hash = hashSocialApprovalPayload(base);
  assert.equal(isSocialApprovalIntact(hash, base), true);
  assert.equal(isSocialApprovalIntact(hash, { ...base, content: `${base.content} changed` }), false);
  assert.equal(isSocialApprovalIntact(hash, { ...base, accountId: 'another-account' }), false);
  assert.equal(isSocialApprovalIntact(hash, { ...base, platformAccountId: 'another-member' }), false);
  assert.equal(isSocialApprovalIntact(hash, { ...base, scheduledAt: null }), false);
});

test('only the current server-approved schedule version can claim one publication attempt', () => {
  const approved = {
    status: SocialPostStatus.SCHEDULED,
    approvedBy: 'owner-1',
    approvedAt: new Date('2026-10-16T12:00:00.000Z'),
    userId: 'owner-1',
    approvalHash: hashSocialApprovalPayload(payload),
    approvalPayload: payload,
    currentScheduleVersion: 4,
    jobScheduleVersion: 4,
  };
  assert.equal(canClaimSocialPublication(approved), true);
  assert.equal(
    canClaimSocialPublication({ ...approved, status: SocialPostStatus.PUBLISHING }),
    false
  );
  assert.equal(canClaimSocialPublication({ ...approved, userId: 'other-user' }), false);
  assert.equal(canClaimSocialPublication({ ...approved, approvedAt: null }), false);
  assert.equal(
    canClaimSocialPublication({
      ...approved,
      approvalPayload: { ...payload, destinationLabel: 'Different destination' },
    }),
    false
  );
  assert.equal(canClaimSocialPublication({ ...approved, jobScheduleVersion: 3 }), false);
});

test('social post queries always constrain by owner identity', () => {
  assert.deepEqual(ownedSocialPostWhere('user-a'), { userId: 'user-a' });
  assert.deepEqual(ownedSocialPostWhere('user-a', 'post-1'), { userId: 'user-a', id: 'post-1' });
  assert.notDeepEqual(ownedSocialPostWhere('user-a', 'post-1'), ownedSocialPostWhere('user-b', 'post-1'));
});
