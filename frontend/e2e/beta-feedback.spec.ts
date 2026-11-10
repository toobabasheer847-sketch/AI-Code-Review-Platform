import { expect, test } from '@playwright/test'

import { mockApi, type MockResponse } from './api-mock'

const user = {
  id: 'user-e2e',
  email: 'developer@example.test',
  fullName: 'E2E Developer',
  avatar: null,
  isVerified: true,
  githubConnected: false,
  githubUsername: null,
  betaStatus: 'ACTIVE',
  onboardingDismissedAt: null,
  betaAdmin: true,
  createdAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
}

function json(body: unknown, status = 200): MockResponse {
  return { body, status }
}

test('shows beta limits, submits a bug, and lets an admin change its status', async ({ page }) => {
  const feedback: Array<{ id: string; subject: string; category: string; status: string; body: string }> = []
  await mockApi(page, async ({ method, path, route }) => {
    if (path === '/auth/me') return json({ user })
    if (path === '/automations') return json([])
    if (path === '/reviews') return json([])
    if (path === '/workspaces') return json({ workspaces: [] })
    if (path === '/beta/guide') {
      return json({
        limitations: ['This beta can change or reset. Do not rely on it for production customer data.'],
        dismissed: false,
        steps: [
          { id: 'workspace', label: 'Create a workspace for the team you want to review with', href: '/workspaces', complete: false },
          { id: 'github', label: 'Connect the GitHub account that can read the repository', href: '/github/repos', complete: false },
          { id: 'review', label: 'Run one AI code review and read the findings before sharing them', href: '/reviews', complete: false },
        ],
      })
    }
    if (path === '/beta/feedback' && method === 'GET') return json({ feedback })
    if (path === '/beta/feedback' && method === 'POST') {
      const body = route.request().postDataJSON() as { subject: string; category: string; body: string }
      feedback.push({ id: 'feedback-1', subject: body.subject, category: body.category, status: 'OPEN', body: body.body })
      return json({ feedback: feedback[0] }, 201)
    }
    if (path === '/beta/admin/overview') {
      return json({
        users: [{ id: user.id, email: user.email, fullName: user.fullName, betaStatus: 'ACTIVE', createdAt: user.createdAt }],
        feedback,
        usage: { REGISTRATION: 1, FEEDBACK_SUBMITTED: feedback.length },
      })
    }
    if (path === '/beta/admin/feedback/feedback-1' && method === 'PATCH') {
      const body = route.request().postDataJSON() as { status: string }
      if (feedback[0]) feedback[0].status = body.status
      return json({ feedback: feedback[0] })
    }
    return undefined
  })

  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Controlled beta' })).toBeVisible()
  await expect(page.getByText('Create a workspace for the team you want to review with')).toBeVisible()
  await expect(page.getByText('Connect the GitHub account that can read the repository')).toBeVisible()
  await expect(page.getByText('Run one AI code review and read the findings before sharing them')).toBeVisible()

  await page.getByRole('link', { name: 'Send feedback' }).click()
  await expect(page).toHaveURL(/\/feedback$/)
  await page.getByLabel('Subject').fill('Findings list stayed empty')
  await page.getByLabel('Details').fill('The mocked review page did not show findings.')
  await page.getByRole('button', { name: 'Submit feedback' }).click()
  await expect(page.getByRole('status')).toContainText('Feedback submitted')

  await page.goto('/beta-admin')
  await expect(page.getByRole('heading', { name: 'Beta users' })).toBeVisible()
  await expect(page.getByText('Findings list stayed empty')).toBeVisible()
  await page.getByLabel('Status for Findings list stayed empty').selectOption('TRIAGED')
  await expect(page.getByText('BUG · TRIAGED')).toBeVisible()
})
