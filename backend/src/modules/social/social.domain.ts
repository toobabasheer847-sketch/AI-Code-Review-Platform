import { createHash, timingSafeEqual } from 'node:crypto';
import { SocialPostStatus, SocialProvider } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export const LINKEDIN_POST_MAX_CHARACTERS = 3_000;
export const SOCIAL_APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const SOCIAL_MAX_SCHEDULE_DAYS = 30;
export const SOCIAL_MAX_SAFE_RETRIES = 3;

export function ownedSocialPostWhere(userId: string, postId?: string): Prisma.SocialPostWhereInput {
  return { userId, ...(postId ? { id: postId } : {}) };
}

export interface SocialApprovalPayload {
  postId: string;
  platform: SocialProvider;
  accountId: string;
  platformAccountId: string;
  destinationLabel: string;
  content: string;
  scheduledAt: string | null;
}

export function validateLinkedInContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) throw new Error('Post content is required.');
  if (Array.from(normalized).length > LINKEDIN_POST_MAX_CHARACTERS) {
    throw new Error(`LinkedIn posts must be ${LINKEDIN_POST_MAX_CHARACTERS} characters or fewer.`);
  }
  return normalized;
}

export function validateScheduleDate(value: Date | null, now = new Date()): void {
  if (!value) return;
  if (!Number.isFinite(value.getTime())) throw new Error('Schedule time is invalid.');
  const earliest = now.getTime() + 60_000;
  const latest = now.getTime() + SOCIAL_MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1_000;
  if (value.getTime() < earliest || value.getTime() > latest) {
    throw new Error('Choose a schedule time at least one minute and no more than 30 days ahead.');
  }
}

export function createSocialApprovalPayload(input: SocialApprovalPayload): SocialApprovalPayload {
  return {
    postId: input.postId,
    platform: input.platform,
    accountId: input.accountId,
    platformAccountId: input.platformAccountId,
    destinationLabel: input.destinationLabel,
    content: input.content,
    scheduledAt: input.scheduledAt,
  };
}

export function hashSocialApprovalPayload(payload: SocialApprovalPayload): string {
  return createHash('sha256').update(JSON.stringify(createSocialApprovalPayload(payload))).digest('hex');
}

export function isSocialApprovalIntact(
  expectedHash: string | null,
  payload: SocialApprovalPayload
): boolean {
  if (!expectedHash) return false;
  const actual = hashSocialApprovalPayload(payload);
  const expected = Buffer.from(expectedHash, 'hex');
  const actualBytes = Buffer.from(actual, 'hex');
  return expected.length === actualBytes.length && timingSafeEqual(expected, actualBytes);
}

export function canClaimSocialPublication(input: {
  status: SocialPostStatus;
  approvedBy: string | null;
  approvedAt: Date | null;
  userId: string;
  approvalHash: string | null;
  approvalPayload: SocialApprovalPayload;
  currentScheduleVersion: number;
  jobScheduleVersion: number;
}): boolean {
  return (
    input.status === SocialPostStatus.SCHEDULED &&
    input.approvedBy === input.userId &&
    input.approvedAt !== null &&
    isSocialApprovalIntact(input.approvalHash, input.approvalPayload) &&
    input.currentScheduleVersion === input.jobScheduleVersion
  );
}
