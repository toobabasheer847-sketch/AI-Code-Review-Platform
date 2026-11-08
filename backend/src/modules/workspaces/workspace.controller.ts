import type { Request, Response } from 'express'
import { z } from 'zod'
import logger from '@/utils/logger'
import { updateFindingStatusSchema } from '@/modules/code-review/finding-lifecycle.domain'
import { WorkspaceService, WorkspaceServiceError } from './workspace.service'
import { WorkspaceResourceService } from './workspace-resource.service'

const service = new WorkspaceService()
const resources = new WorkspaceResourceService()
const createWorkspaceSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    organizationName: z.string().trim().min(2).max(100).optional(),
  })
  .strict()
const inviteSchema = z
  .object({
    email: z.string().trim().email().max(254),
    role: z.enum(['ADMIN', 'DEVELOPER', 'VIEWER']),
  })
  .strict()
const acceptInvitationSchema = z
  .object({ token: z.string().min(32).max(128) })
  .strict()
const updateMemberSchema = z
  .object({
    role: z.enum(['ADMIN', 'DEVELOPER', 'VIEWER']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict()
  .refine((value) => value.role !== undefined || value.status !== undefined)
const transferSchema = z.object({ newOwnerId: z.string().min(1) }).strict()
const updateWorkspaceSchema = z.object({ name: z.string().trim().min(2).max(80) }).strict()

function respondError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof WorkspaceServiceError) {
    res.status(error.statusCode).json({ error: error.message })
    return
  }
  logger.error(
    { errorType: error instanceof Error ? error.name : 'UnknownError' },
    'Workspace request failed'
  )
  res.status(500).json({ error: fallback })
}

function userId(req: Request, res: Response): string | null {
  const id = req.user?.userId
  if (!id) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return id
}

export class WorkspaceController {
  async list(req: Request, res: Response): Promise<void> {
    const id = userId(req, res)
    if (!id) return
    try {
      res.json({ workspaces: await service.listForUser(id) })
    } catch (error) {
      respondError(res, error, 'Unable to list workspaces')
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    const id = userId(req, res)
    if (!id) return
    const parsed = createWorkspaceSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid workspace details' })
      return
    }
    try {
      res.status(201).json({ workspace: await service.create(id, parsed.data) })
    } catch (error) {
      respondError(res, error, 'Unable to create workspace')
    }
  }

  async createInOrganization(req: Request, res: Response): Promise<void> {
    const id = userId(req, res)
    if (!id) return
    const parsed = z.object({ name: z.string().trim().min(2).max(80) }).strict().safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid workspace details' })
      return
    }
    try {
      const workspace = await service.createInOrganization(
        req.params.organizationId ?? '',
        id,
        parsed.data
      )
      res.status(201).json({ workspace: { ...workspace, role: 'OWNER' } })
    } catch (error) {
      respondError(res, error, 'Unable to create organization workspace')
    }
  }

  async update(req: Request, res: Response): Promise<void> {
    const parsed = updateWorkspaceSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid workspace details' })
      return
    }
    try {
      const workspace = await service.update(req.workspace!.id, parsed.data)
      res.json({ workspace: { ...workspace, role: req.workspace!.role } })
    } catch (error) {
      respondError(res, error, 'Unable to update workspace')
    }
  }

  async acceptInvitation(req: Request, res: Response): Promise<void> {
    const id = userId(req, res)
    if (!id) return
    const parsed = acceptInvitationSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid invitation token' })
      return
    }
    try {
      res.json({ membership: await service.acceptInvitation(id, parsed.data.token) })
    } catch (error) {
      respondError(res, error, 'Unable to accept invitation')
    }
  }

  async members(req: Request, res: Response): Promise<void> {
    try {
      res.json({ members: await service.listMembers(req.workspace!.id) })
    } catch (error) {
      respondError(res, error, 'Unable to list workspace members')
    }
  }

  async invitations(req: Request, res: Response): Promise<void> {
    try {
      res.json({ invitations: await service.listInvitations(req.workspace!.id) })
    } catch (error) {
      respondError(res, error, 'Unable to list workspace invitations')
    }
  }

  async repositories(req: Request, res: Response): Promise<void> {
    try {
      res.json({ repositories: await resources.listRepositories(req.workspace!.id) })
    } catch (error) {
      respondError(res, error, 'Unable to list workspace repositories')
    }
  }

  async billing(req: Request, res: Response): Promise<void> {
    try {
      res.json({ billing: await resources.getBilling(req.workspace!.id) })
    } catch (error) {
      respondError(res, error, 'Unable to load workspace billing')
    }
  }

  async reviews(req: Request, res: Response): Promise<void> {
    try {
      res.json({ reviews: await resources.listReviews(req.workspace!.id) })
    } catch (error) {
      respondError(res, error, 'Unable to list workspace reviews')
    }
  }

  async review(req: Request, res: Response): Promise<void> {
    try {
      res.json({
        review: await resources.getReview(req.workspace!.id, req.params.reviewId ?? ''),
      })
    } catch (error) {
      respondError(res, error, 'Unable to load workspace review')
    }
  }

  async startReview(req: Request, res: Response): Promise<void> {
    const id = userId(req, res)
    if (!id) return
    const parsed = z
      .object({
        repository: z.string().min(3).max(300),
        branch: z.string().min(1).max(255).optional(),
      })
      .strict()
      .safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid review request' })
      return
    }
    try {
      const review = await resources.startReview(
        req.workspace!.id,
        id,
        parsed.data.repository,
        parsed.data.branch ?? 'main'
      )
      res.status(201).json({ reviewId: review.id })
    } catch (error) {
      respondError(res, error, 'Unable to start workspace review')
    }
  }

  async updateFindingStatus(req: Request, res: Response): Promise<void> {
    const id = userId(req, res)
    if (!id) return
    const parsed = updateFindingStatusSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid finding status update' })
      return
    }
    try {
      const result = await resources.updateFindingStatus(
        req.workspace!.id,
        id,
        req.params.findingId ?? '',
        parsed.data.status,
        parsed.data.reason
      )
      res.json(result)
    } catch (error) {
      respondError(res, error, 'Unable to update finding status')
    }
  }

  async invite(req: Request, res: Response): Promise<void> {
    const id = userId(req, res)
    if (!id) return
    const parsed = inviteSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide a valid email address and role' })
      return
    }
    try {
      const invitation = await service.createAndSendInvitation(
        req.workspace!.id,
        id,
        parsed.data.email,
        parsed.data.role
      )
      res.status(201).json({ invitation })
    } catch (error) {
      respondError(res, error, 'Unable to create invitation')
    }
  }

  async resendInvitation(req: Request, res: Response): Promise<void> {
    const id = userId(req, res)
    if (!id) return
    try {
      const invitation = await service.resendInvitation(
        req.workspace!.id,
        req.params.invitationId ?? '',
        id
      )
      res.status(201).json({ invitation })
    } catch (error) {
      respondError(res, error, 'Unable to resend invitation')
    }
  }

  async revokeInvitation(req: Request, res: Response): Promise<void> {
    try {
      await service.revokeInvitation(req.workspace!.id, req.params.invitationId ?? '')
      res.status(204).end()
    } catch (error) {
      respondError(res, error, 'Unable to revoke invitation')
    }
  }

  async updateMember(req: Request, res: Response): Promise<void> {
    const id = userId(req, res)
    if (!id) return
    const parsed = updateMemberSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid workspace member update' })
      return
    }
    try {
      const member = await service.updateMember(
        req.workspace!.id,
        id,
        req.workspace!.role,
        req.params.membershipId ?? '',
        parsed.data
      )
      res.json({ member })
    } catch (error) {
      respondError(res, error, 'Unable to update workspace member')
    }
  }

  async removeMember(req: Request, res: Response): Promise<void> {
    const id = userId(req, res)
    if (!id) return
    try {
      await service.removeMember(
        req.workspace!.id,
        id,
        req.workspace!.role,
        req.params.membershipId ?? ''
      )
      res.status(204).end()
    } catch (error) {
      respondError(res, error, 'Unable to remove workspace member')
    }
  }

  async transferOwnership(req: Request, res: Response): Promise<void> {
    const id = userId(req, res)
    if (!id) return
    const parsed = transferSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide a valid new owner' })
      return
    }
    try {
      await service.transferOwnership(req.workspace!.id, id, parsed.data.newOwnerId)
      res.json({ transferred: true })
    } catch (error) {
      respondError(res, error, 'Unable to transfer workspace ownership')
    }
  }
}
