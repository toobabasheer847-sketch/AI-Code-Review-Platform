import assert from 'node:assert/strict'
import test from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import {
  createWorkspaceAccessMiddleware,
  optionalWorkspacePermission,
  requireWorkspacePermission,
  type WorkspaceAccessStore,
} from './workspace-access.middleware'

function responseHarness() {
  let statusCode = 200
  let body: unknown
  const response = {
    status(code: number) {
      statusCode = code
      return this
    },
    json(value: unknown) {
      body = value
      return this
    },
  } as unknown as Response
  return { response, status: () => statusCode, body: () => body }
}

function workspaceRequest(role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'VIEWER'): Request {
  return {
    workspace: {
      id: 'workspace-a',
      organizationId: 'org-a',
      organizationOwnerUserId: 'user-a',
      isPersonal: false,
      role,
    },
  } as unknown as Request
}

function requestHarness(workspaceId: string, userId = 'user-a') {
  return {
    user: { userId },
    params: { workspaceId },
  } as unknown as Request
}

test('workspace access middleware denies a different workspace without active membership', async () => {
  const store: WorkspaceAccessStore = {
    async findActiveMembership(workspaceId, userId) {
      return workspaceId === 'workspace-a' && userId === 'user-a'
        ? {
            id: 'workspace-a',
            organizationId: 'org-a',
            organizationOwnerUserId: 'user-a',
            isPersonal: false,
            role: 'OWNER',
          }
        : null
    },
  }
  const middleware = createWorkspaceAccessMiddleware(store)
  const result = responseHarness()
  let nextCalled = false

  await middleware(requestHarness('workspace-b'), result.response, (() => {
    nextCalled = true
  }) as NextFunction)

  assert.equal(result.status(), 404)
  assert.equal(nextCalled, false)
})

test('active workspace membership is attached as trusted request context', async () => {
  const store: WorkspaceAccessStore = {
    async findActiveMembership(workspaceId, userId) {
      assert.equal(workspaceId, 'workspace-a')
      assert.equal(userId, 'user-a')
      return {
        id: workspaceId,
        organizationId: 'org-a',
        organizationOwnerUserId: 'user-a',
        isPersonal: false,
        role: 'DEVELOPER',
      }
    },
  }
  const middleware = createWorkspaceAccessMiddleware(store)
  const request = requestHarness('workspace-a')
  const result = responseHarness()
  let nextCalled = false

  await middleware(request, result.response, (() => {
    nextCalled = true
  }) as NextFunction)

  assert.equal(nextCalled, true)
  assert.equal(request.workspace?.role, 'DEVELOPER')
})

test('only owners and admins can pass the invitation permission check', () => {
  for (const role of ['DEVELOPER', 'VIEWER'] as const) {
    const result = responseHarness()
    let nextCalled = false
    requireWorkspacePermission('manage_members')(workspaceRequest(role), result.response, (() => {
      nextCalled = true
    }) as NextFunction)
    assert.equal(result.status(), 403)
    assert.equal(nextCalled, false)
  }

  for (const role of ['OWNER', 'ADMIN'] as const) {
    const result = responseHarness()
    let nextCalled = false
    requireWorkspacePermission('manage_members')(workspaceRequest(role), result.response, (() => {
      nextCalled = true
    }) as NextFunction)
    assert.equal(nextCalled, true)
    assert.equal(result.status(), 200)
  }
})

test('workspace permission middleware returns forbidden for disallowed mutations', () => {
  const request = {
    workspace: {
      id: 'workspace-a',
      organizationId: 'org-a',
      organizationOwnerUserId: 'user-a',
      isPersonal: false,
      role: 'VIEWER',
    },
  } as unknown as Request
  const result = responseHarness()
  let nextCalled = false

  requireWorkspacePermission('update_findings')(request, result.response, (() => {
    nextCalled = true
  }) as NextFunction)

  assert.equal(result.status(), 403)
  assert.equal(nextCalled, false)
})

test('workspace header is only used after active membership is resolved and role permission passes', async () => {
  const store: WorkspaceAccessStore = {
    async findActiveMembership(workspaceId, userId) {
      assert.equal(workspaceId, 'workspace-a')
      assert.equal(userId, 'user-a')
      return {
        id: workspaceId,
        organizationId: 'org-a',
        organizationOwnerUserId: 'owner-a',
        isPersonal: false,
        role: 'VIEWER',
      }
    },
  }
  const middleware = optionalWorkspacePermission('create_automation', store)
  const request = {
    user: { userId: 'user-a' },
    params: {},
    get: () => 'workspace-a',
  } as unknown as Request
  const result = responseHarness()
  let nextCalled = false

  await middleware(request, result.response, (() => {
    nextCalled = true
  }) as NextFunction)

  assert.equal(request.workspace?.id, 'workspace-a')
  assert.equal(result.status(), 403)
  assert.equal(nextCalled, false)
})

test('workspace header denies suspended or removed membership', async () => {
  const middleware = optionalWorkspacePermission('read', {
    async findActiveMembership() {
      return null
    },
  })
  const request = {
    user: { userId: 'user-a' },
    params: {},
    get: () => 'workspace-a',
  } as unknown as Request
  const result = responseHarness()
  let nextCalled = false

  await middleware(request, result.response, (() => {
    nextCalled = true
  }) as NextFunction)

  assert.equal(result.status(), 404)
  assert.equal(nextCalled, false)
})
