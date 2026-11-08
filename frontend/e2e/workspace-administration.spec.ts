import { expect, test } from '@playwright/test'

import { mockApi, type MockResponse } from './api-mock'

const user = {
  id: 'user-owner',
  email: 'owner@example.test',
  fullName: 'Ada Lovelace',
  avatar: null,
  isVerified: true,
  githubConnected: false,
  githubUsername: null,
  createdAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
}

const secret = 'super-secret-invitation-token-value'

const team = {
  id: 'ws-team',
  organizationId: 'org-team',
  name: 'Platform Team',
  slug: 'platform-team',
  isPersonal: false,
  role: 'OWNER',
  organization: { id: 'org-team', name: 'Platform Org', slug: 'platform-org' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const viewerWorkspace = {
  ...team,
  id: 'ws-view',
  name: 'Audit View',
  slug: 'audit-view',
  role: 'VIEWER',
}

const members = [
  {
    id: 'member-owner',
    userId: 'user-owner',
    role: 'OWNER',
    status: 'ACTIVE',
    joinedAt: '2026-01-01T00:00:00.000Z',
    user: { email: user.email, fullName: user.fullName, avatar: null },
  },
  {
    id: 'member-developer',
    userId: 'user-developer',
    role: 'DEVELOPER',
    status: 'ACTIVE',
    joinedAt: '2026-02-01T00:00:00.000Z',
    user: { email: 'grace@example.test', fullName: 'Grace Hopper', avatar: null },
  },
]

function json(body: unknown, status = 200): MockResponse {
  return { body, status }
}

test.describe.configure({ timeout: 60_000 })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('ai-codeguard-active-workspace', 'ws-team')
  })
})

test('manages workspace members and hides owner actions from a viewer', async ({ page }) => {
  let invited = false
  let resent = false
  const expiredInvitation = {
    id: 'inv-expired',
    email: 'late@example.test',
    role: 'VIEWER',
    invitedById: user.id,
    expiresAt: '2020-01-01T00:00:00.000Z',
    createdAt: '2019-12-01T00:00:00.000Z',
  }
  await mockApi(page, async ({ method, path, route }) => {
    if (path === '/auth/me' && method === 'GET') return json({ user })
    if (path === '/workspaces' && method === 'GET') return json({ workspaces: [team, viewerWorkspace] })
    if (path === '/workspaces/ws-team/members' && method === 'GET') return json({ members })
    if (path === '/workspaces/ws-view/members' && method === 'GET') {
      return json({
        members: [
          {
            id: 'member-viewer',
            userId: user.id,
            role: 'VIEWER',
            status: 'ACTIVE',
            joinedAt: '2026-03-01T00:00:00.000Z',
            user: { email: user.email, fullName: user.fullName, avatar: null },
          },
        ],
      })
    }
    if (path === '/workspaces/ws-team/invitations' && method === 'GET') {
      return json({
        invitations: [
          ...(invited
            ? [
                {
                  id: resent ? 'inv-resent' : 'inv-created',
                  email: 'new@example.test',
                  role: 'DEVELOPER',
                  invitedById: user.id,
                  expiresAt: resent ? '2027-06-01T00:00:00.000Z' : '2027-01-01T00:00:00.000Z',
                  createdAt: '2026-11-08T00:00:00.000Z',
                },
              ]
            : []),
          expiredInvitation,
        ],
      })
    }
    if (path === '/workspaces/ws-team/invitations' && method === 'POST') {
      invited = true
      return json(
        {
          invitation: {
            id: 'inv-created',
            workspaceId: 'ws-team',
            email: 'new@example.test',
            role: 'DEVELOPER',
            expiresAt: '2027-01-01T00:00:00.000Z',
            token: secret,
            acceptUrl: `http://127.0.0.1:3000/accept-invitation?token=${secret}`,
          },
        },
        201
      )
    }
    if (path === '/workspaces/ws-team/invitations/inv-created/resend' && method === 'POST') {
      resent = true
      return json(
        {
          invitation: {
            id: 'inv-resent',
            email: 'new@example.test',
            role: 'DEVELOPER',
            expiresAt: '2027-06-01T00:00:00.000Z',
            token: secret,
            acceptUrl: `http://127.0.0.1:3000/accept-invitation?token=${secret}`,
          },
        },
        201
      )
    }
    if (path === '/workspaces/ws-team/members/member-developer' && method === 'PATCH') {
      const body = route.request().postDataJSON() as { role?: string; status?: string }
      return json({ member: { id: 'member-developer', role: body.role ?? 'DEVELOPER', status: body.status ?? 'ACTIVE' } })
    }
    return undefined
  })

  await page.goto('/workspaces')
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('paragraph').filter({ hasText: 'Grace Hopper' })).toBeVisible()
  await page.getByLabel('Email address').fill('new@example.test')
  await page.getByRole('button', { name: 'Invite member' }).click()
  await expect(page.locator('p[role="status"]', { hasText: 'Invitation email sent to new@example.test.' })).toBeVisible()
  await expect(page.getByText(secret)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Resend invitation for late@example.test' })).toHaveCount(0)
  await expect(page.getByText('This invitation has expired. Revoke it before sending a new one.')).toBeVisible()
  await page.getByRole('button', { name: 'Resend invitation for new@example.test' }).click()
  await page.getByRole('button', { name: 'Resend invitation', exact: true }).click()
  await expect(page.locator('p[role="status"]', { hasText: 'Invitation email resent to new@example.test.' })).toBeVisible()
  await expect(page.getByText('6/1/2027')).toBeVisible()
  await expect(page.getByText(secret)).toHaveCount(0)

  await page.getByLabel('Role for Grace Hopper').selectOption('VIEWER')
  await page.getByRole('button', { name: 'Save role for Grace Hopper' }).click()
  await expect(page.getByText('Member updated').first()).toBeVisible()

  await page.getByRole('button', { name: 'Suspend Grace Hopper' }).click()
  await page.getByRole('button', { name: 'Suspend member' }).click()
  await expect(page.getByText('Member updated').first()).toBeVisible()

  await page.getByRole('button', { name: /Platform Team/ }).click()
  await page.getByRole('option', { name: /Audit View/ }).click()
  await expect(page.getByText('Viewers can view members')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Invite member' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save workspace' })).toHaveCount(0)
})

test('keeps the workspace page usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page, async ({ method, path }) => {
    if (path === '/auth/me' && method === 'GET') return json({ user })
    if (path === '/workspaces' && method === 'GET') return json({ workspaces: [team] })
    if (path === '/workspaces/ws-team/members' && method === 'GET') return json({ members })
    if (path === '/workspaces/ws-team/invitations' && method === 'GET') return json({ invitations: [] })
    return undefined
  })

  await page.goto('/workspaces')
  await expect(page.getByRole('button', { name: 'Invite member' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('paragraph').filter({ hasText: 'Grace Hopper' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Platform Team/ })).toBeVisible()
})

test('accepts, expires, and rejects unusable invitations without showing the secret', async ({ page }) => {
  let acceptStatus = 200
  await mockApi(page, async ({ method, path }) => {
    if (path === '/auth/me' && method === 'GET') return json({ user })
    if (path === '/workspaces' && method === 'GET') return json({ workspaces: [team] })
    if (path === '/workspaces/invitations/accept' && method === 'POST') {
      if (acceptStatus === 410) return json({ error: `Invitation has expired ${secret}` }, 410)
      if (acceptStatus === 404) return json({ error: 'Invitation is invalid or has already been used' }, 404)
      return json({ membership: { workspaceId: 'ws-team', role: 'DEVELOPER' } })
    }
    return undefined
  })

  await page.goto(`/accept-invitation?token=${secret}`)
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toBeVisible({ timeout: 20_000 })
  await expect(page).toHaveURL(/\/accept-invitation$/)
  await expect(page.getByText(secret)).toHaveCount(0)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page.getByRole('heading', { name: 'Invitation accepted' })).toBeVisible()
  await expect(page.getByText(secret)).toHaveCount(0)
  await page.getByRole('link', { name: 'Go to workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 })

  acceptStatus = 410
  await page.goto(`/accept-invitation?token=${secret}`)
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toBeVisible({ timeout: 20_000 })
  await expect(page).toHaveURL(/\/accept-invitation$/)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page.getByRole('heading', { name: 'Invitation expired' })).toBeVisible()
  await expect(page.getByText(secret)).toHaveCount(0)

  acceptStatus = 404
  await page.goto(`/accept-invitation?token=${secret}`)
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toBeVisible({ timeout: 20_000 })
  await expect(page).toHaveURL(/\/accept-invitation$/)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page.getByRole('heading', { name: 'Invitation unavailable' })).toBeVisible()
  await expect(page.getByText(/revoked/i)).toBeVisible()
  await expect(page.getByText(secret)).toHaveCount(0)
})
