import { createHash, randomBytes } from 'node:crypto'
import { Prisma, type WorkspaceMemberStatus, type WorkspaceRole } from '@prisma/client'
import { prisma } from '@/config/database'
import {
  canTransferOrganizationOwnership,
  invitationAcceptanceFailure,
  normalizeInvitationEmail,
  normalizeWorkspaceSlug,
} from './workspace.domain'

export class WorkspaceServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
    this.name = 'WorkspaceServiceError'
  }
}

export async function getPersonalWorkspaceId(userId: string): Promise<string> {
  const membership = await prisma.workspaceMembership.findFirst({
    where: {
      userId,
      status: 'ACTIVE',
      workspace: { is: { isPersonal: true } },
    },
    select: { workspaceId: true },
  })
  if (!membership) throw new Error('Personal workspace is not configured')
  return membership.workspaceId
}

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function createInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  )
}

export class WorkspaceService {
  async listForUser(userId: string) {
    const memberships = await prisma.workspaceMembership.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        workspace: {
          include: { organization: { select: { id: true, name: true, slug: true } } },
        },
      },
      orderBy: [{ workspace: { organization: { name: 'asc' } } }, { workspace: { name: 'asc' } }],
    })
    return memberships.map(({ workspace, role }) => ({ ...workspace, role }))
  }

  async create(userId: string, input: { name: string; organizationName?: string }) {
    const name = input.name.trim()
    if (name.length < 2 || name.length > 80) {
      throw new WorkspaceServiceError(400, 'Workspace name must be between 2 and 80 characters')
    }
    let slug: string
    try {
      slug = normalizeWorkspaceSlug(name)
    } catch {
      throw new WorkspaceServiceError(400, 'Workspace name must contain letters or numbers')
    }
    const suffix = randomBytes(3).toString('hex')

    return prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.create({
        data: {
          name: input.organizationName?.trim() || name,
          slug: `${slug}-${suffix}`,
          ownerUserId: userId,
          billing: { create: {} },
        },
      })
      const workspace = await transaction.workspace.create({
        data: {
          organizationId: organization.id,
          name,
          slug,
          memberships: {
            create: { userId, role: 'OWNER', status: 'ACTIVE' },
          },
        },
        include: { organization: { select: { id: true, name: true, slug: true } } },
      })
      return { ...workspace, role: 'OWNER' as const }
    })
  }

  async createInOrganization(
    organizationId: string,
    userId: string,
    input: { name: string }
  ) {
    const name = input.name.trim()
    if (name.length < 2 || name.length > 80) {
      throw new WorkspaceServiceError(400, 'Workspace name must be between 2 and 80 characters')
    }
    let slug: string
    try {
      slug = normalizeWorkspaceSlug(name)
    } catch {
      throw new WorkspaceServiceError(400, 'Workspace name must contain letters or numbers')
    }

    return prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.findFirst({
        where: { id: organizationId, ownerUserId: userId, isPersonal: false },
        select: { id: true },
      })
      if (!organization) throw new WorkspaceServiceError(404, 'Organization not found')
      try {
        return await transaction.workspace.create({
          data: {
            organizationId,
            name,
            slug,
            memberships: {
              create: { userId, role: 'OWNER', status: 'ACTIVE' },
            },
          },
          include: { organization: { select: { id: true, name: true, slug: true } } },
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new WorkspaceServiceError(409, 'A workspace with this name already exists')
        }
        throw error
      }
    })
  }

  async listMembers(workspaceId: string) {
    return prisma.workspaceMembership.findMany({
      where: { workspaceId },
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        joinedAt: true,
        user: { select: { email: true, fullName: true, avatar: true } },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    })
  }

  async listInvitations(workspaceId: string) {
    return prisma.workspaceInvitation.findMany({
      where: { workspaceId, status: 'PENDING' },
      select: {
        id: true,
        email: true,
        role: true,
        invitedById: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async createInvitation(
    workspaceId: string,
    invitedById: string,
    email: string,
    role: WorkspaceRole
  ) {
    if (role === 'OWNER') {
      throw new WorkspaceServiceError(400, 'Ownership can only be granted by transfer')
    }
    const normalizedEmail = normalizeInvitationEmail(email)
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { isPersonal: true },
    })
    if (!workspace) throw new WorkspaceServiceError(404, 'Workspace not found')
    if (workspace.isPersonal) {
      throw new WorkspaceServiceError(409, 'Personal workspaces cannot invite other members')
    }
    const existingMember = await prisma.workspaceMembership.findFirst({
      where: {
        workspaceId,
        user: { is: { email: { equals: normalizedEmail, mode: 'insensitive' } } },
        status: { in: ['ACTIVE', 'SUSPENDED'] },
      },
      select: { id: true },
    })
    if (existingMember) throw new WorkspaceServiceError(409, 'This user is already a workspace member')

    const token = createInvitationToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    try {
      const invitation = await prisma.workspaceInvitation.create({
        data: {
          workspaceId,
          email: normalizedEmail,
          role,
          tokenHash: hashInvitationToken(token),
          invitedById,
          expiresAt,
        },
        select: { id: true, workspaceId: true, email: true, role: true, expiresAt: true },
      })
      return { ...invitation, token }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new WorkspaceServiceError(409, 'A pending invitation already exists for this email')
      }
      throw error
    }
  }

  async acceptInvitation(userId: string, token: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isVerified: true },
    })
    if (!user) {
      throw new WorkspaceServiceError(403, 'A verified account is required to accept invitations')
    }

    const tokenHash = hashInvitationToken(token)
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "WorkspaceInvitation" WHERE "tokenHash" = ${tokenHash} FOR UPDATE
      `
      const invitation = await transaction.workspaceInvitation.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          workspaceId: true,
          email: true,
          role: true,
          status: true,
          expiresAt: true,
        },
      })
      if (!invitation) {
        throw new WorkspaceServiceError(404, 'Invitation is invalid or has already been used')
      }
      const failure = invitationAcceptanceFailure({
        email: invitation.email,
        userEmail: user.email,
        userIsVerified: user.isVerified,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      })
      if (failure === 'EXPIRED') {
        await transaction.workspaceInvitation.update({
          where: { id: invitation.id },
          data: { status: 'EXPIRED' },
        })
        return { expired: true as const }
      }
      if (failure === 'INVALID') {
        throw new WorkspaceServiceError(404, 'Invitation is invalid or has already been used')
      }
      if (failure === 'UNVERIFIED') {
        throw new WorkspaceServiceError(403, 'A verified account is required to accept invitations')
      }
      if (failure === 'EMAIL_MISMATCH') {
        throw new WorkspaceServiceError(403, 'Sign in with the email address that received this invitation')
      }
      if (failure === 'INVALID_ROLE') {
        throw new WorkspaceServiceError(409, 'Invalid invitation role')
      }

      const currentMembership = await transaction.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: { workspaceId: invitation.workspaceId, userId },
        },
        select: { status: true },
      })
      if (currentMembership && currentMembership.status !== 'REMOVED') {
        throw new WorkspaceServiceError(409, 'You already have a workspace membership')
      }

      await transaction.workspaceMembership.upsert({
        where: {
          workspaceId_userId: { workspaceId: invitation.workspaceId, userId },
        },
        create: {
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
          status: 'ACTIVE',
        },
        update: {
          role: invitation.role,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      })
      await transaction.workspaceInvitation.update({
        where: { id: invitation.id },
        data: {
          status: 'ACCEPTED',
          acceptedById: userId,
          acceptedAt: new Date(),
        },
      })
      return {
        expired: false as const,
        membership: { workspaceId: invitation.workspaceId, role: invitation.role },
      }
    })
    if (result.expired) throw new WorkspaceServiceError(410, 'Invitation has expired')
    return result.membership
  }

  async revokeInvitation(workspaceId: string, invitationId: string): Promise<void> {
    const result = await prisma.workspaceInvitation.updateMany({
      where: { id: invitationId, workspaceId, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    })
    if (result.count !== 1) throw new WorkspaceServiceError(404, 'Invitation not found')
  }

  async updateMember(
    workspaceId: string,
    actingUserId: string,
    actingRole: WorkspaceRole,
    membershipId: string,
    input: { role?: WorkspaceRole; status?: WorkspaceMemberStatus }
  ) {
    const membership = await prisma.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId },
      select: { id: true, userId: true, role: true, status: true },
    })
    if (!membership || membership.status === 'REMOVED') {
      throw new WorkspaceServiceError(404, 'Workspace member not found')
    }
    if (membership.role === 'OWNER') {
      throw new WorkspaceServiceError(409, 'Workspace ownership can only be changed by transfer')
    }
    if (
      actingRole === 'ADMIN' &&
      (membership.role === 'ADMIN' || input.role === 'ADMIN')
    ) {
      throw new WorkspaceServiceError(403, 'Admins cannot manage other admins')
    }
    if (input.role === 'OWNER') {
      throw new WorkspaceServiceError(400, 'Ownership can only be granted by transfer')
    }
    if (input.status === 'REMOVED') {
      throw new WorkspaceServiceError(400, 'Use the member removal endpoint')
    }
    if (membership.userId === actingUserId && input.status === 'SUSPENDED') {
      throw new WorkspaceServiceError(400, 'You cannot suspend your own membership')
    }
    return prisma.workspaceMembership.update({
      where: { id: membership.id },
      data: {
        ...(input.role ? { role: input.role } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      select: { id: true, userId: true, role: true, status: true, joinedAt: true },
    })
  }

  async removeMember(
    workspaceId: string,
    actingUserId: string,
    actingRole: WorkspaceRole,
    membershipId: string
  ): Promise<void> {
    const member = await prisma.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId, status: { not: 'REMOVED' } },
      select: { id: true, userId: true, role: true },
    })
    if (!member) throw new WorkspaceServiceError(404, 'Workspace member not found')
    if (member.role === 'OWNER') {
      throw new WorkspaceServiceError(409, 'Transfer ownership before removing an owner')
    }
    if (actingRole === 'ADMIN' && member.role === 'ADMIN' && member.userId !== actingUserId) {
      throw new WorkspaceServiceError(403, 'Admins cannot remove other admins')
    }
    await prisma.workspaceMembership.update({
      where: { id: member.id },
      data: { status: 'REMOVED' },
    })
  }

  async transferOwnership(
    workspaceId: string,
    currentOwnerId: string,
    newOwnerId: string
  ): Promise<void> {
    if (currentOwnerId === newOwnerId) {
      throw new WorkspaceServiceError(400, 'The new owner must be another workspace member')
    }
    await prisma.$transaction(async (transaction) => {
      const workspace = await transaction.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          id: true,
          isPersonal: true,
          organizationId: true,
          organization: { select: { ownerUserId: true } },
        },
      })
      if (!workspace) throw new WorkspaceServiceError(404, 'Workspace not found')
      const workspaces = await transaction.workspace.findMany({
        where: { organizationId: workspace.organizationId },
        select: { id: true },
      })
      const workspaceIds = workspaces.map((item) => item.id)
      const memberships = await transaction.workspaceMembership.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          userId: newOwnerId,
          status: 'ACTIVE',
        },
        select: { workspaceId: true },
      })
      if (!canTransferOrganizationOwnership({
        currentOwnerId,
        newOwnerId,
        personalWorkspace: workspace.isPersonal,
        organizationOwnerId: workspace.organization.ownerUserId,
        organizationWorkspaceIds: workspaceIds,
        newOwnerActiveWorkspaceIds: memberships.map((membership) => membership.workspaceId),
      })) {
        if (workspace.isPersonal) {
          throw new WorkspaceServiceError(409, 'Personal workspace ownership cannot be transferred')
        }
        if (workspace.organization.ownerUserId !== currentOwnerId) {
          throw new WorkspaceServiceError(403, 'Only the organization owner can transfer ownership')
        }
        throw new WorkspaceServiceError(
          409,
          'The new owner must be an active member of every organization workspace'
        )
      }

      const transferred = await transaction.organization.updateMany({
        where: { id: workspace.organizationId, ownerUserId: currentOwnerId },
        data: { ownerUserId: newOwnerId },
      })
      if (transferred.count !== 1) {
        throw new WorkspaceServiceError(409, 'Organization ownership has already changed')
      }
      await transaction.workspaceMembership.updateMany({
        where: { workspaceId: { in: workspaceIds }, userId: currentOwnerId, status: 'ACTIVE' },
        data: { role: 'ADMIN' },
      })
      await transaction.workspaceMembership.updateMany({
        where: { workspaceId: { in: workspaceIds }, userId: newOwnerId, status: 'ACTIVE' },
        data: { role: 'OWNER' },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  }
}
