import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  canTransferOrganizationOwnership,
  canAssignWorkspaceRole,
  canInviteWorkspaceRole,
  canManageExistingMember,
  hasWorkspacePermission,
  invitationAcceptanceFailure,
  invitationDeclineFailure,
  normalizeInvitationEmail,
  normalizeWorkspaceSlug,
  workspaceReviewWhere,
} from './workspace.domain'

test('workspace roles enforce read, mutation, administration, billing, and transfer boundaries', () => {
  assert.equal(hasWorkspacePermission('OWNER', 'manage_billing'), true)
  assert.equal(hasWorkspacePermission('OWNER', 'transfer_ownership'), true)
  assert.equal(hasWorkspacePermission('ADMIN', 'manage_members'), true)
  assert.equal(hasWorkspacePermission('ADMIN', 'manage_billing'), false)
  assert.equal(hasWorkspacePermission('ADMIN', 'transfer_ownership'), false)
  assert.equal(hasWorkspacePermission('DEVELOPER', 'start_review'), true)
  assert.equal(hasWorkspacePermission('DEVELOPER', 'approve_automation'), false)
  assert.equal(hasWorkspacePermission('DEVELOPER', 'create_social_posts'), true)
  assert.equal(hasWorkspacePermission('DEVELOPER', 'approve_social_posts'), false)
  assert.equal(hasWorkspacePermission('ADMIN', 'approve_social_posts'), true)
  assert.equal(hasWorkspacePermission('DEVELOPER', 'manage_integrations'), false)
  assert.equal(hasWorkspacePermission('VIEWER', 'read'), true)
  assert.equal(hasWorkspacePermission('VIEWER', 'update_findings'), false)
  assert.equal(hasWorkspacePermission('DEVELOPER', 'manage_members'), false)
  assert.equal(hasWorkspacePermission('VIEWER', 'manage_members'), false)
  assert.equal(hasWorkspacePermission('VIEWER', 'transfer_ownership'), false)
  assert.equal(hasWorkspacePermission('SECURITY_ADMIN', 'view_audit'), true)
  assert.equal(hasWorkspacePermission('SECURITY_ADMIN', 'manage_members'), false)
  assert.equal(hasWorkspacePermission('SECURITY_ADMIN', 'manage_billing'), false)
  assert.equal(hasWorkspacePermission('REVIEWER', 'update_findings'), true)
  assert.equal(hasWorkspacePermission('REVIEWER', 'start_review'), false)
  assert.equal(hasWorkspacePermission('BILLING_ADMIN', 'manage_billing'), true)
  assert.equal(hasWorkspacePermission('BILLING_ADMIN', 'view_audit'), false)
  assert.equal(canInviteWorkspaceRole('ADMIN', 'SECURITY_ADMIN'), false)
  assert.equal(canInviteWorkspaceRole('ADMIN', 'ADMIN'), true)
  assert.equal(canInviteWorkspaceRole('OWNER', 'BILLING_ADMIN'), true)
  assert.equal(canAssignWorkspaceRole('ADMIN', 'REVIEWER'), true)
  assert.equal(canAssignWorkspaceRole('ADMIN', 'ADMIN'), false)
  assert.equal(canAssignWorkspaceRole('OWNER', 'SECURITY_ADMIN'), true)
  assert.equal(canManageExistingMember('ADMIN', 'SECURITY_ADMIN'), false)
  assert.equal(canManageExistingMember('ADMIN', 'DEVELOPER'), true)
})

test('workspace invitation acceptance checks single-use state, expiry, verification, and email', () => {
  const base = {
    email: 'member@example.com',
    userEmail: 'Member@Example.com',
    userIsVerified: true,
    role: 'DEVELOPER' as const,
    status: 'PENDING' as const,
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  }
  const now = new Date('2026-12-01T00:00:00.000Z')

  assert.equal(invitationAcceptanceFailure(base, now), null)
  assert.equal(
    invitationAcceptanceFailure({ ...base, status: 'ACCEPTED' }, now),
    'INVALID'
  )
  assert.equal(
    invitationAcceptanceFailure(
      { ...base, expiresAt: new Date('2026-11-30T00:00:00.000Z') },
      now
    ),
    'EXPIRED'
  )
  assert.equal(
    invitationAcceptanceFailure({ ...base, userIsVerified: false }, now),
    'UNVERIFIED'
  )
  assert.equal(
    invitationAcceptanceFailure({ ...base, userEmail: 'other@example.com' }, now),
    'EMAIL_MISMATCH'
  )
  assert.equal(
    invitationAcceptanceFailure({ ...base, role: 'OWNER' }, now),
    'INVALID_ROLE'
  )
  assert.equal(invitationAcceptanceFailure({ ...base, status: 'DECLINED' }, now), 'INVALID')
  assert.equal(invitationDeclineFailure(base, now), null)
  assert.equal(invitationDeclineFailure({ ...base, status: 'ACCEPTED' }, now), 'ACCEPTED')
  assert.equal(invitationDeclineFailure({ ...base, status: 'REVOKED' }, now), 'REVOKED')
  assert.equal(invitationDeclineFailure({ ...base, status: 'DECLINED' }, now), 'ALREADY_DECLINED')
  assert.equal(
    invitationDeclineFailure({ ...base, expiresAt: new Date('2026-11-30T00:00:00.000Z') }, now),
    'EXPIRED'
  )
  assert.equal(invitationDeclineFailure({ ...base, userIsVerified: false }, now), 'UNVERIFIED')
  assert.equal(
    invitationDeclineFailure({ ...base, userEmail: 'other@example.com' }, now),
    'EMAIL_MISMATCH'
  )
  assert.equal(normalizeInvitationEmail(' Member@Example.com '), 'member@example.com')
})

test('ownership transfer requires a non-personal workspace and recipient membership everywhere', () => {
  const base = {
    currentOwnerId: 'owner-a',
    newOwnerId: 'owner-b',
    personalWorkspace: false,
    organizationOwnerId: 'owner-a',
    organizationWorkspaceIds: ['workspace-a', 'workspace-b'],
    newOwnerActiveWorkspaceIds: ['workspace-a', 'workspace-b'],
  }
  assert.equal(canTransferOrganizationOwnership(base), true)
  assert.equal(
    canTransferOrganizationOwnership({
      ...base,
      newOwnerActiveWorkspaceIds: ['workspace-a'],
    }),
    false
  )
  assert.equal(
    canTransferOrganizationOwnership({ ...base, personalWorkspace: true }),
    false
  )
  assert.equal(
    canTransferOrganizationOwnership({ ...base, organizationOwnerId: 'other-owner' }),
    false
  )
})

test('workspace resource lookup always includes the active workspace scope', () => {
  assert.deepEqual(workspaceReviewWhere('workspace-a'), { workspaceId: 'workspace-a' })
  assert.deepEqual(workspaceReviewWhere('workspace-a', 'review-1'), {
    workspaceId: 'workspace-a',
    id: 'review-1',
  })
  assert.notDeepEqual(workspaceReviewWhere('workspace-a', 'review-1'), {
    id: 'review-1',
  })
})

test('workspace slugs normalize unicode and reject empty or oversized names', () => {
  assert.equal(normalizeWorkspaceSlug('Dév Team'), 'dev-team')
  assert.throws(() => normalizeWorkspaceSlug('  '), /valid slug/)
  assert.throws(() => normalizeWorkspaceSlug('a'.repeat(65)), /valid slug/)
})

test('tenancy migration backfills legacy rows and contains no destructive SQL', async () => {
  const sql = await readFile(
    new URL('../../prisma/migrations/20261106000000_workspace_tenancy/migration.sql', import.meta.url),
    'utf8'
  )
  assert.match(sql, /INSERT INTO "Organization"/)
  assert.match(sql, /INSERT INTO "WorkspaceMembership"/)
  assert.match(sql, /UPDATE "Repository" SET "workspaceId"/)
  assert.match(sql, /UPDATE "CodeReview" SET "workspaceId"/)
  assert.match(sql, /UPDATE "AIRequestUsage" SET "workspaceId"/)
  assert.match(sql, /Workspace backfill left tenant-owned records unassigned or assigned to the wrong user/)
  assert.match(sql, /Rollback strategy: revert the application deployment while retaining/)
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(DROP|DELETE FROM|TRUNCATE)\b/i)
})
