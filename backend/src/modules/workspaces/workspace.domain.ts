import type {
  WorkspaceInvitationStatus,
  WorkspaceRole,
} from '@prisma/client'

export type WorkspacePermission =
  | 'read'
  | 'start_review'
  | 'update_findings'
  | 'create_fix_proposal'
  | 'verify_fix'
  | 'create_automation'
  | 'approve_automation'
  | 'create_social_posts'
  | 'approve_social_posts'
  | 'manage_reviews'
  | 'manage_repository'
  | 'manage_integrations'
  | 'manage_members'
  | 'view_billing'
  | 'manage_billing'
  | 'transfer_ownership'
  | 'view_audit'

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

const ownerAssignedRoles: ReadonlySet<WorkspaceRole> = new Set([
  'SECURITY_ADMIN',
  'BILLING_ADMIN',
])

export function canInviteWorkspaceRole(actorRole: WorkspaceRole, role: WorkspaceRole): boolean {
  if (role === 'OWNER') return false
  if (actorRole === 'OWNER') return true
  if (actorRole !== 'ADMIN') return false
  return !ownerAssignedRoles.has(role)
}

export function canAssignWorkspaceRole(actorRole: WorkspaceRole, role: WorkspaceRole): boolean {
  if (role === 'OWNER') return false
  if (actorRole === 'OWNER') return true
  if (actorRole !== 'ADMIN') return false
  return role === 'DEVELOPER' || role === 'REVIEWER' || role === 'VIEWER'
}

export function canManageExistingMember(actorRole: WorkspaceRole, memberRole: WorkspaceRole): boolean {
  if (memberRole === 'OWNER') return false
  if (actorRole === 'OWNER') return true
  if (actorRole !== 'ADMIN') return false
  return memberRole !== 'ADMIN' && !ownerAssignedRoles.has(memberRole)
}

export function hasWorkspacePermission(
  role: WorkspaceRole,
  permission: WorkspacePermission
): boolean {
  return rolePermissions[role].has(permission)
}

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase()
}

export type InvitationAcceptanceFailure =
  | 'INVALID'
  | 'EXPIRED'
  | 'UNVERIFIED'
  | 'EMAIL_MISMATCH'
  | 'INVALID_ROLE'

export type InvitationDeclineFailure =
  | InvitationAcceptanceFailure
  | 'ACCEPTED'
  | 'REVOKED'
  | 'ALREADY_DECLINED'

export function invitationAcceptanceFailure(input: {
  email: string
  userEmail: string
  userIsVerified: boolean
  role: WorkspaceRole
  status: WorkspaceInvitationStatus
  expiresAt: Date
}, now = new Date()): InvitationAcceptanceFailure | null {
  if (input.status !== 'PENDING') return 'INVALID'
  if (input.expiresAt <= now) return 'EXPIRED'
  if (!input.userIsVerified) return 'UNVERIFIED'
  if (normalizeInvitationEmail(input.userEmail) !== input.email) return 'EMAIL_MISMATCH'
  if (input.role === 'OWNER') return 'INVALID_ROLE'
  return null
}

export function invitationDeclineFailure(input: {
  email: string
  userEmail: string
  userIsVerified: boolean
  role: WorkspaceRole
  status: WorkspaceInvitationStatus
  expiresAt: Date
}, now = new Date()): InvitationDeclineFailure | null {
  if (input.status === 'ACCEPTED') return 'ACCEPTED'
  if (input.status === 'REVOKED') return 'REVOKED'
  if (input.status === 'DECLINED') return 'ALREADY_DECLINED'
  if (input.status === 'EXPIRED' || input.expiresAt <= now) return 'EXPIRED'
  if (input.status !== 'PENDING') return 'INVALID'
  if (!input.userIsVerified) return 'UNVERIFIED'
  if (normalizeInvitationEmail(input.userEmail) !== input.email) return 'EMAIL_MISMATCH'
  if (input.role === 'OWNER') return 'INVALID_ROLE'
  return null
}

export function canTransferOrganizationOwnership(input: {
  currentOwnerId: string
  newOwnerId: string
  personalWorkspace: boolean
  organizationOwnerId: string
  organizationWorkspaceIds: string[]
  newOwnerActiveWorkspaceIds: string[]
}): boolean {
  return (
    !input.personalWorkspace &&
    input.currentOwnerId !== input.newOwnerId &&
    input.organizationOwnerId === input.currentOwnerId &&
    input.organizationWorkspaceIds.every((id) =>
      input.newOwnerActiveWorkspaceIds.includes(id)
    )
  )
}

export function workspaceReviewWhere(workspaceId: string, reviewId?: string) {
  return { workspaceId, ...(reviewId ? { id: reviewId } : {}) }
}

export function normalizeWorkspaceSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug || slug.length > 64) throw new Error('Workspace name must produce a valid slug')
  return slug
}
