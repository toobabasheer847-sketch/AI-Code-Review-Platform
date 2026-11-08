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
  ]),
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
