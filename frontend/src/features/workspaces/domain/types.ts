export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'VIEWER'

export type WorkspaceMemberStatus = 'ACTIVE' | 'SUSPENDED' | 'REMOVED'

export type InvitableWorkspaceRole = Exclude<WorkspaceRole, 'OWNER'>

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

export interface WorkspaceOrganization {
  id: string
  name: string
  slug: string
}

export interface WorkspaceSummary {
  id: string
  organizationId: string
  name: string
  slug: string
  isPersonal: boolean
  role: WorkspaceRole
  organization: WorkspaceOrganization
  createdAt: string
  updatedAt: string
}

export interface WorkspaceMember {
  id: string
  userId: string
  role: WorkspaceRole
  status: WorkspaceMemberStatus
  joinedAt: string
  user: {
    email: string
    fullName: string | null
    avatar: string | null
  }
}

export type WorkspaceInvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED' | 'DECLINED'

export interface WorkspaceInvitation {
  id: string
  email: string
  role: WorkspaceRole
  status?: WorkspaceInvitationStatus
  invitedById: string
  expiresAt: string
  createdAt: string
}
