import { describe, expect, it } from 'vitest'

import {
  assignableMemberRoles,
  canInviteMembers,
  canReactivateMember,
  canRemoveMember,
  canRenameWorkspace,
  canSuspendMember,
  canTransferWorkspaceOwnership,
  canUpdateMember,
  hasWorkspacePermission,
  invitationIsExpired,
  invitableRoles,
  resolveActiveWorkspaceId,
  workspaceNameError,
} from './workspace-access'

describe('workspace administration access', () => {
  it('mirrors owner, admin, developer, and viewer permissions', () => {
    expect(hasWorkspacePermission('OWNER', 'manage_members')).toBe(true)
    expect(hasWorkspacePermission('OWNER', 'transfer_ownership')).toBe(true)
    expect(hasWorkspacePermission('OWNER', 'manage_billing')).toBe(true)
    expect(hasWorkspacePermission('ADMIN', 'manage_members')).toBe(true)
    expect(hasWorkspacePermission('ADMIN', 'view_billing')).toBe(true)
    expect(hasWorkspacePermission('ADMIN', 'manage_billing')).toBe(false)
    expect(hasWorkspacePermission('ADMIN', 'transfer_ownership')).toBe(false)
    expect(hasWorkspacePermission('DEVELOPER', 'start_review')).toBe(true)
    expect(hasWorkspacePermission('DEVELOPER', 'manage_members')).toBe(false)
    expect(hasWorkspacePermission('DEVELOPER', 'create_social_posts')).toBe(true)
    expect(hasWorkspacePermission('VIEWER', 'read')).toBe(true)
    expect(hasWorkspacePermission('VIEWER', 'manage_members')).toBe(false)
    expect(hasWorkspacePermission('VIEWER', 'update_findings')).toBe(false)
    expect(hasWorkspacePermission('SECURITY_ADMIN', 'view_audit')).toBe(true)
    expect(hasWorkspacePermission('SECURITY_ADMIN', 'manage_members')).toBe(false)
    expect(hasWorkspacePermission('REVIEWER', 'update_findings')).toBe(true)
    expect(hasWorkspacePermission('REVIEWER', 'start_review')).toBe(false)
    expect(hasWorkspacePermission('BILLING_ADMIN', 'manage_billing')).toBe(true)
    expect(hasWorkspacePermission('BILLING_ADMIN', 'view_audit')).toBe(false)
  })

  it('keeps rename, invite, and transfer aligned with backend service rules', () => {
    expect(canRenameWorkspace('OWNER', false)).toBe(true)
    expect(canRenameWorkspace('ADMIN', false)).toBe(true)
    expect(canRenameWorkspace('DEVELOPER', false)).toBe(false)
    expect(canRenameWorkspace('OWNER', true)).toBe(false)
    expect(canInviteMembers('ADMIN', false)).toBe(true)
    expect(canInviteMembers('VIEWER', false)).toBe(false)
    expect(canInviteMembers('OWNER', true)).toBe(false)
    expect(canTransferWorkspaceOwnership('OWNER', false)).toBe(true)
    expect(canTransferWorkspaceOwnership('ADMIN', false)).toBe(false)
    expect(canTransferWorkspaceOwnership('OWNER', true)).toBe(false)
    expect(invitableRoles('OWNER')).toEqual([
      'ADMIN',
      'SECURITY_ADMIN',
      'DEVELOPER',
      'REVIEWER',
      'BILLING_ADMIN',
      'VIEWER',
    ])
    expect(invitableRoles('ADMIN')).toEqual(['ADMIN', 'DEVELOPER', 'REVIEWER', 'VIEWER'])
    expect(assignableMemberRoles('ADMIN')).toEqual(['DEVELOPER', 'REVIEWER', 'VIEWER'])
    expect(invitableRoles('DEVELOPER')).toEqual([])
  })

  it('hides member actions the membership service rejects', () => {
    const developer = {
      actorRole: 'OWNER' as const,
      actorUserId: 'owner',
      memberUserId: 'developer',
      memberRole: 'DEVELOPER' as const,
      memberStatus: 'ACTIVE' as const,
    }
    expect(canUpdateMember(developer)).toBe(true)
    expect(canSuspendMember(developer)).toBe(true)
    expect(canRemoveMember(developer)).toBe(true)
    expect(canSuspendMember({ ...developer, actorUserId: 'developer', memberUserId: 'developer' })).toBe(false)
    expect(canReactivateMember({ ...developer, memberStatus: 'SUSPENDED' })).toBe(true)
    expect(canUpdateMember({ ...developer, memberRole: 'OWNER' })).toBe(false)
    expect(canRemoveMember({ ...developer, memberRole: 'OWNER' })).toBe(false)
    expect(canUpdateMember({ ...developer, memberStatus: 'REMOVED' })).toBe(false)
    expect(
      canUpdateMember({ ...developer, actorRole: 'ADMIN', memberRole: 'ADMIN' })
    ).toBe(false)
    expect(
      canRemoveMember({
        ...developer,
        actorRole: 'ADMIN',
        actorUserId: 'admin-a',
        memberUserId: 'admin-b',
        memberRole: 'ADMIN',
      })
    ).toBe(false)
    expect(
      canRemoveMember({
        ...developer,
        actorRole: 'ADMIN',
        actorUserId: 'admin-a',
        memberUserId: 'admin-a',
        memberRole: 'ADMIN',
      })
    ).toBe(true)
    expect(canSuspendMember({ ...developer, actorRole: 'VIEWER' })).toBe(false)
    expect(canUpdateMember({ ...developer, actorRole: 'ADMIN', memberRole: 'SECURITY_ADMIN' })).toBe(false)
    expect(canUpdateMember({ ...developer, actorRole: 'ADMIN', memberRole: 'BILLING_ADMIN' })).toBe(false)
    expect(canUpdateMember({ ...developer, actorRole: 'OWNER', memberRole: 'REVIEWER' })).toBe(true)
  })

  it('prefers the stored workspace, then the personal workspace', () => {
    const workspaces = [
      { id: 'team', isPersonal: false },
      { id: 'personal', isPersonal: true },
    ]
    expect(resolveActiveWorkspaceId(workspaces, 'team')).toBe('team')
    expect(resolveActiveWorkspaceId(workspaces, 'missing')).toBe('personal')
    expect(resolveActiveWorkspaceId([{ id: 'team', isPersonal: false }], null)).toBe('team')
    expect(resolveActiveWorkspaceId([], 'team')).toBeNull()
  })

  it('validates workspace names the same way the API slug rules do', () => {
    expect(workspaceNameError('Platform')).toBeNull()
    expect(workspaceNameError(' a ')).not.toBeNull()
    expect(workspaceNameError('---')).not.toBeNull()
    expect(workspaceNameError('a'.repeat(80))).not.toBeNull()
  })

  it('marks invitations expired from their timestamp', () => {
    expect(invitationIsExpired('2020-01-01T00:00:00.000Z', Date.parse('2026-11-08T00:00:00.000Z'))).toBe(true)
    expect(invitationIsExpired('2027-01-01T00:00:00.000Z', Date.parse('2026-11-08T00:00:00.000Z'))).toBe(false)
  })
})
