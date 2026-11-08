import { isAxiosError } from 'axios'

import { axiosInstance } from '@/lib/axios'

import type {
  InvitableWorkspaceRole,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceMemberStatus,
  WorkspaceRole,
  WorkspaceSummary,
} from '../domain/types'

interface WorkspaceListResponse {
  workspaces?: WorkspaceSummary[]
}

interface WorkspaceResponse {
  workspace: WorkspaceSummary
}

interface MembersResponse {
  members: WorkspaceMember[]
}

interface InvitationsResponse {
  invitations: WorkspaceInvitation[]
}

interface InvitationResponse {
  invitation: {
    id: string
    email: string
    role: WorkspaceRole
    expiresAt: string
    token?: string
    acceptUrl?: string
  }
}

export function getWorkspaceErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<Record<string, unknown>>(error)) {
    const data = error.response?.data
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error.trim()
        : ''
    if (message && !/token|accept-invitation/i.test(message)) return message
  }
  return fallback
}

function listedWorkspaces(data: unknown): WorkspaceSummary[] {
  if (Array.isArray(data)) return []
  if (
    data &&
    typeof data === 'object' &&
    'workspaces' in data &&
    Array.isArray((data as WorkspaceListResponse).workspaces)
  ) {
    return (data as WorkspaceListResponse).workspaces ?? []
  }
  throw new Error('Unable to load workspaces')
}

function publicInvitation(
  invitation: InvitationResponse['invitation']
): Pick<WorkspaceInvitation, 'id' | 'email' | 'role' | 'expiresAt'> {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
  }
}

export const workspaceApi = {
  async list(): Promise<WorkspaceSummary[]> {
    const response = await axiosInstance.get<unknown>('/workspaces')
    return listedWorkspaces(response.data)
  },
  async create(input: { name: string; organizationName?: string }): Promise<WorkspaceSummary> {
    const response = await axiosInstance.post<WorkspaceResponse>('/workspaces', input)
    return response.data.workspace
  },
  async update(workspaceId: string, name: string): Promise<WorkspaceSummary> {
    const response = await axiosInstance.patch<WorkspaceResponse>(`/workspaces/${workspaceId}`, { name })
    return response.data.workspace
  },
  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const response = await axiosInstance.get<MembersResponse>(`/workspaces/${workspaceId}/members`)
    return response.data.members
  },
  async listInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const response = await axiosInstance.get<InvitationsResponse>(`/workspaces/${workspaceId}/invitations`)
    return response.data.invitations
  },
  async invite(
    workspaceId: string,
    input: { email: string; role: InvitableWorkspaceRole }
  ): Promise<Pick<WorkspaceInvitation, 'id' | 'email' | 'role' | 'expiresAt'>> {
    const response = await axiosInstance.post<InvitationResponse>(
      `/workspaces/${workspaceId}/invitations`,
      input
    )
    return publicInvitation(response.data.invitation)
  },
  async resendInvitation(
    workspaceId: string,
    invitationId: string
  ): Promise<Pick<WorkspaceInvitation, 'id' | 'email' | 'role' | 'expiresAt'>> {
    const response = await axiosInstance.post<InvitationResponse>(
      `/workspaces/${workspaceId}/invitations/${invitationId}/resend`
    )
    return publicInvitation(response.data.invitation)
  },
  async revokeInvitation(workspaceId: string, invitationId: string): Promise<void> {
    await axiosInstance.delete(`/workspaces/${workspaceId}/invitations/${invitationId}`)
  },
  async updateMember(
    workspaceId: string,
    membershipId: string,
    input: { role?: InvitableWorkspaceRole; status?: Extract<WorkspaceMemberStatus, 'ACTIVE' | 'SUSPENDED'> }
  ): Promise<void> {
    await axiosInstance.patch(`/workspaces/${workspaceId}/members/${membershipId}`, input)
  },
  async removeMember(workspaceId: string, membershipId: string): Promise<void> {
    await axiosInstance.delete(`/workspaces/${workspaceId}/members/${membershipId}`)
  },
  async transferOwnership(workspaceId: string, newOwnerId: string): Promise<void> {
    await axiosInstance.post(`/workspaces/${workspaceId}/transfer-ownership`, { newOwnerId })
  },
  async declineInvitation(token: string): Promise<{ id: string; status: 'DECLINED' }> {
    const response = await axiosInstance.post<{
      invitation?: { id?: string; status?: string; token?: string; acceptUrl?: string }
    }>('/workspaces/invitations/decline', { token })
    return {
      id: response.data.invitation?.id ?? '',
      status: 'DECLINED',
    }
  },
  async acceptInvitation(token: string): Promise<{ workspaceId: string; role: WorkspaceRole }> {
    const response = await axiosInstance.post<{ membership: { workspaceId: string; role: WorkspaceRole } }>(
      '/workspaces/invitations/accept',
      { token }
    )
    return response.data.membership
  },
}
