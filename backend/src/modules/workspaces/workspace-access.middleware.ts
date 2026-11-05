import type { NextFunction, Request, Response } from 'express'
import type { WorkspaceRole } from '@prisma/client'
import { prisma } from '@/config/database'
import {
  hasWorkspacePermission,
  type WorkspacePermission,
} from './workspace.domain'

export interface WorkspaceAccess {
  id: string
  organizationId: string
  organizationOwnerUserId: string
  isPersonal: boolean
  role: WorkspaceRole
}

export interface WorkspaceAccessStore {
  findActiveMembership(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceAccess | null>
}

const prismaWorkspaceAccessStore: WorkspaceAccessStore = {
  async findActiveMembership(workspaceId, userId) {
    const membership = await prisma.workspaceMembership.findFirst({
      where: { workspaceId, userId, status: 'ACTIVE' },
      select: {
        role: true,
        workspace: {
          select: {
            id: true,
            organizationId: true,
            isPersonal: true,
            organization: { select: { ownerUserId: true } },
          },
        },
      },
    })
    if (!membership) return null
    return {
      id: membership.workspace.id,
      organizationId: membership.workspace.organizationId,
      organizationOwnerUserId: membership.workspace.organization.ownerUserId,
      isPersonal: membership.workspace.isPersonal,
      role: membership.role,
    }
  },
}

declare global {
  namespace Express {
    interface Request {
      workspace?: WorkspaceAccess
    }
  }
}

export function createWorkspaceAccessMiddleware(
  store: WorkspaceAccessStore = prismaWorkspaceAccessStore
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.userId
    const workspaceId = req.params.workspaceId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!workspaceId) {
      res.status(400).json({ error: 'Workspace is required' })
      return
    }

    try {
      const membership = await store.findActiveMembership(workspaceId, userId)
      if (!membership) {
        res.status(404).json({ error: 'Workspace not found' })
        return
      }
      req.workspace = membership
      next()
    } catch (error) {
      next(error)
    }
  }
}

export function requireWorkspacePermission(permission: WorkspacePermission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.workspace) {
      res.status(404).json({ error: 'Workspace not found' })
      return
    }
    if (!hasWorkspacePermission(req.workspace.role, permission)) {
      res.status(403).json({ error: 'Insufficient workspace permissions' })
      return
    }
    next()
  }
}

export const workspaceAccessMiddleware = createWorkspaceAccessMiddleware()
