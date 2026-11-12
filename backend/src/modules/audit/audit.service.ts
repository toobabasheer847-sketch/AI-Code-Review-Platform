import type { Prisma, PrismaClient } from '@prisma/client'
import logger from '@/utils/logger'

export const auditActions = {
  login: 'auth.login',
  loginFailed: 'auth.login_failed',
  logout: 'auth.logout',
  organizationCreated: 'organization.created',
  workspaceCreated: 'workspace.created',
  workspaceUpdated: 'workspace.updated',
  invitationCreated: 'invitation.created',
  invitationRevoked: 'invitation.revoked',
  invitationAccepted: 'invitation.accepted',
  invitationDeclined: 'invitation.declined',
  membershipRoleChanged: 'membership.role_changed',
  membershipStatusChanged: 'membership.status_changed',
  membershipRemoved: 'membership.removed',
  ownershipTransferred: 'organization.ownership_transferred',
  reviewStarted: 'review.started',
  billingUpdated: 'billing.updated',
  repositoryConnected: 'repository.connected',
} as const

export type AuditAction = (typeof auditActions)[keyof typeof auditActions]

const allowedActions = new Set<string>(Object.values(auditActions))
const allowedResources = new Set([
  'session',
  'organization',
  'workspace',
  'invitation',
  'membership',
  'code_review',
  'subscription',
  'github_account',
])

export interface AuditEventInput {
  actorId?: string | null
  organizationId?: string | null
  workspaceId?: string | null
  action: AuditAction
  resourceType: string
  resourceId?: string | null
}

type AuditClient = PrismaClient | Prisma.TransactionClient

export function auditEventData(input: AuditEventInput): {
  actorId: string | null
  organizationId: string | null
  workspaceId: string | null
  action: AuditAction
  resourceType: string
  resourceId: string | null
} {
  if (!allowedActions.has(input.action)) throw new Error('Unsupported audit action')
  if (!allowedResources.has(input.resourceType)) {
    throw new Error('Unsupported audit resource')
  }
  return {
    actorId: input.actorId ?? null,
    organizationId: input.organizationId ?? null,
    workspaceId: input.workspaceId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
  }
}

export async function recordAuditEvent(
  client: AuditClient,
  input: AuditEventInput,
  options?: { required?: boolean }
): Promise<void> {
  const data = auditEventData(input)
  const write = client.auditEvent.create({ data })
  if (options?.required === false) {
    try {
      await write
    } catch (error) {
      logger.warn({ err: error, action: input.action }, 'Audit event was not recorded')
    }
    return
  }
  await write
}

export async function recordWorkspaceAudit(
  client: AuditClient,
  input: AuditEventInput & { workspaceId: string }
): Promise<void> {
  const organizationId =
    input.organizationId ??
    (
      await client.workspace.findUnique({
        where: { id: input.workspaceId },
        select: { organizationId: true },
      })
    )?.organizationId ??
    null
  await recordAuditEvent(client, { ...input, organizationId })
}

export async function recordAuthenticationAudit(input: AuditEventInput): Promise<void> {
  const { prisma } = await import('@/config/database')
  await recordAuditEvent(prisma, input, { required: false })
}
