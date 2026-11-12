import type {
  InvitableWorkspaceRole,
  WorkspaceMemberStatus,
  WorkspacePermission,
  WorkspaceRole,
} from './types'

/**
 * Mirrors backend/src/modules/workspaces/workspace.domain.ts.
 * The API remains the authority; these checks only decide what the UI offers.
 */
const rolePermissions: Record<WorkspaceRole, ReadonlySet<WorkspacePermission>> = {
  OWNER: new Set([
    'read',
    'start_review',
    'update_findings',
    'create_fix_proposal',
    'verify_fix',
    'create_automation',
    'approve_automation',
    'create_social_posts',
    'approve_social_posts',
    'manage_reviews',
    'manage_repository',
    'manage_integrations',
    'manage_members',
    'view_billing',
    'manage_billing',
    'transfer_ownership',
    'view_audit',
  ]),
  ADMIN: new Set([
    'read',
    'start_review',
    'update_findings',
    'create_fix_proposal',
    'verify_fix',
    'create_automation',
    'approve_automation',
    'create_social_posts',
    'approve_social_posts',
    'manage_reviews',
    'manage_repository',
    'manage_integrations',
    'manage_members',
    'view_billing',
    'view_audit',
  ]),
  SECURITY_ADMIN: new Set([
    'read',
    'start_review',
    'update_findings',
    'verify_fix',
    'manage_reviews',
    'manage_repository',
    'manage_integrations',
    'view_billing',
    'view_audit',
  ]),
  REVIEWER: new Set(['read', 'update_findings', 'verify_fix']),
  BILLING_ADMIN: new Set(['read', 'view_billing', 'manage_billing']),
  DEVELOPER: new Set([
    'read',
    'start_review',
    'update_findings',
    'create_fix_proposal',
    'verify_fix',
    'create_automation',
    'create_social_posts',
  ]),
  VIEWER: new Set(['read']),
}

export const workspaceRoleLabels: Record<WorkspaceRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  SECURITY_ADMIN: 'Security Admin',
  DEVELOPER: 'Developer',
  REVIEWER: 'Reviewer',
  BILLING_ADMIN: 'Billing Admin',
  VIEWER: 'Viewer',
}

export const workspaceStatusLabels: Record<WorkspaceMemberStatus, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  REMOVED: 'Removed',
}

export function hasWorkspacePermission(role: WorkspaceRole, permission: WorkspacePermission): boolean {
  return rolePermissions[role].has(permission)
}

export function workspaceNameError(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 80) {
    return 'Workspace name must be between 2 and 80 characters'
  }
  const slug = trimmed
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) return 'Workspace name must contain letters or numbers'
  if (slug.length > 64) return 'Workspace name must produce a shorter address'
  return null
}

export function organizationNameError(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  if (trimmed.length < 2 || trimmed.length > 100) {
    return 'Organization name must be between 2 and 100 characters'
  }
  return null
}

export function resolveActiveWorkspaceId(
  workspaces: Array<{ id: string; isPersonal: boolean }>,
  storedId: string | null
): string | null {
  if (storedId && workspaces.some((workspace) => workspace.id === storedId)) return storedId
  return workspaces.find((workspace) => workspace.isPersonal)?.id ?? workspaces[0]?.id ?? null
}

export function canRenameWorkspace(role: WorkspaceRole, isPersonal: boolean): boolean {
  return !isPersonal && hasWorkspacePermission(role, 'manage_members')
}

export function canInviteMembers(role: WorkspaceRole, isPersonal: boolean): boolean {
  return !isPersonal && hasWorkspacePermission(role, 'manage_members')
}

export function canTransferWorkspaceOwnership(role: WorkspaceRole, isPersonal: boolean): boolean {
  return !isPersonal && hasWorkspacePermission(role, 'transfer_ownership')
}

const ownerAssignedRoles = new Set<WorkspaceRole>(['SECURITY_ADMIN', 'BILLING_ADMIN'])

export function canManageExistingMember(actorRole: WorkspaceRole, memberRole: WorkspaceRole): boolean {
  if (memberRole === 'OWNER') return false
  if (actorRole === 'OWNER') return true
  if (actorRole !== 'ADMIN') return false
  return memberRole !== 'ADMIN' && !ownerAssignedRoles.has(memberRole)
}

export function invitableRoles(role: WorkspaceRole): InvitableWorkspaceRole[] {
  if (role === 'OWNER') {
    return ['ADMIN', 'SECURITY_ADMIN', 'DEVELOPER', 'REVIEWER', 'BILLING_ADMIN', 'VIEWER']
  }
  if (role === 'ADMIN') return ['ADMIN', 'DEVELOPER', 'REVIEWER', 'VIEWER']
  return []
}

export function assignableMemberRoles(role: WorkspaceRole): InvitableWorkspaceRole[] {
  if (role === 'OWNER') {
    return ['ADMIN', 'SECURITY_ADMIN', 'DEVELOPER', 'REVIEWER', 'BILLING_ADMIN', 'VIEWER']
  }
  if (role === 'ADMIN') return ['DEVELOPER', 'REVIEWER', 'VIEWER']
  return []
}

export function canUpdateMember(input: {
  actorRole: WorkspaceRole
  memberRole: WorkspaceRole
  memberStatus: WorkspaceMemberStatus
}): boolean {
  if (!hasWorkspacePermission(input.actorRole, 'manage_members')) return false
  if (input.memberStatus === 'REMOVED') return false
  if (!canManageExistingMember(input.actorRole, input.memberRole)) return false
  return true
}

export function canSuspendMember(input: {
  actorRole: WorkspaceRole
  actorUserId: string
  memberUserId: string
  memberRole: WorkspaceRole
  memberStatus: WorkspaceMemberStatus
}): boolean {
  return (
    canUpdateMember(input) &&
    input.memberStatus === 'ACTIVE' &&
    input.actorUserId !== input.memberUserId
  )
}

export function canReactivateMember(input: {
  actorRole: WorkspaceRole
  memberRole: WorkspaceRole
  memberStatus: WorkspaceMemberStatus
}): boolean {
  return canUpdateMember(input) && input.memberStatus === 'SUSPENDED'
}

export function canRemoveMember(input: {
  actorRole: WorkspaceRole
  actorUserId: string
  memberUserId: string
  memberRole: WorkspaceRole
  memberStatus: WorkspaceMemberStatus
}): boolean {
  if (!hasWorkspacePermission(input.actorRole, 'manage_members')) return false
  if (input.memberRole === 'OWNER' || input.memberStatus === 'REMOVED') return false
  if (
    input.actorRole === 'ADMIN' &&
    input.memberUserId !== input.actorUserId &&
    !canManageExistingMember(input.actorRole, input.memberRole)
  ) {
    return false
  }
  return true
}

export function invitationIsExpired(expiresAt: string, now = Date.now()): boolean {
  const time = Date.parse(expiresAt)
  return Number.isFinite(time) && time <= now
}
