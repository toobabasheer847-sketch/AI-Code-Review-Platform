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
  createdAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
}
type MockUser = Omit<typeof user, 'githubConnected' | 'githubUsername'> & {
  githubConnected: boolean
  githubUsername: string | null
}

function json(body: unknown, status = 200, headers?: Record<string, string>): MockResponse {
  return { body, status, headers }
}

test('registers, verifies, logs in, and logs out using accessible controls', async ({ page }) => {
  let currentUser: typeof user | null = null
  let registrationEmail = ''
  await mockApi(page, async ({ method, path, route }) => {
    if (path === '/auth/register' && method === 'POST') {
      registrationEmail = (route.request().postDataJSON() as { email: string }).email
      return json({
        email: registrationEmail,
        verificationRequired: true,
        verificationEmailQueued: true,
        message: 'Verification code sent',
      })
    }
    if (path === '/auth/verify-email' && method === 'POST') {
      return json({ message: 'Email verified', verified: true })
    }
    if (path === '/auth/login' && method === 'POST') {
      currentUser = { ...user, email: registrationEmail, isVerified: true }
      return json({ user: currentUser })
    }
    if (path === '/auth/me') {
      return currentUser ? json({ user: currentUser }) : json({ error: 'Unauthenticated' }, 401)
    }
    if (path === '/auth/logout' && method === 'POST') {
      currentUser = null
      return json({})
    }
    return undefined
  })

  await page.goto('/register')
  await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible()
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Full Name').fill(user.fullName)
  await page.getByLabel('Password', { exact: true }).fill('safe-e2e-password')
  await page.getByLabel('Confirm Password').fill('safe-e2e-password')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/verify-email\?/)
  await page.getByLabel('Six-digit code').fill('123456')
  await page.getByRole('button', { name: 'Verify email' }).click()
  await expect(page).toHaveURL(/\/login\?verified=1/)

  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('safe-e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  await page.goto('/automations')
  await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).last().click()
  await expect(page).toHaveURL(/\/login$/)
})

test('requests and completes the password reset flow without a real mail provider', async ({
  page,
}) => {
  const requests: string[] = []
  await mockApi(page, async ({ method, path }) => {
    if (method === 'POST' && path === '/auth/password-reset/request') {
      requests.push('request')
      return json({ message: 'If an account exists, reset instructions were sent.' })
    }
    if (method === 'POST' && path === '/auth/password-reset/confirm') {
      requests.push('confirm')
      return json({ message: 'Password reset successfully.' })
    }
    return undefined
  })

  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(user.email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByRole('status')).toContainText('reset instructions')

  await page.goto('/reset-password#token=e2e-reset-token')
  await page.getByLabel('New password').fill('another-safe-password')
  await page.getByRole('button', { name: 'Reset password' }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect(requests).toEqual(['request', 'confirm'])
})

test('mocks GitHub OAuth, starts a review, and handles finding feedback and verification', async ({
  page,
}) => {
  let connectedUser: MockUser = { ...user, githubConnected: false, githubUsername: null }
  let reviewStarted = false
  let findingStatus = 'UNREVIEWED'
  let proposalSaved = false
  let verificationRequested = false
  const feedback: Array<Record<string, unknown>> = []
  const assessmentFeedback: Array<Record<string, unknown>> = []
  const now = '2026-11-04T00:00:00.000Z'
  const summary = {
    id: 'review-e2e',
    repository: 'sample/project',
    score: 82,
    issues: 1,
    status: 'completed',
    source: 'MANUAL',
    createdAt: now,
  }
  const attempt = {
    id: 'attempt-e2e',
    patchSha256: 'a'.repeat(64),
    status: 'NEEDS_REVIEW',
    executionStatus: 'BLOCKED',
    testCommands: [],
    checkResults: [],
    testsPassed: null,
    originalIssueReproducedBefore: null,
    originalIssueReproducedAfter: null,
    repositoryName: 'sample/project',
    repositoryUrl: 'https://github.com/sample/project',
    branch: 'main',
    pullRequestNumber: null,
    commitSha: null,
    findingTitle: 'Unsafe input',
    findingSeverity: 'HIGH',
    findingFile: 'src/input.ts',
    changedFiles: [],
    executionDurationMs: 0,
    exitCode: null,
    failureDetails: null,
    humanReviewDecision: null,
    humanReviewNote: null,
    humanReviewedAt: null,
    startedAt: now,
    completedAt: now,
    sanitizedLogs: null,
    jobState: 'NEEDS_REVIEW',
    executionOccurred: false,
    runnerIdentity: null,
    runnerVersion: null,
  }
  const proposal = {
    id: 'proposal-e2e',
    patch: '--- a/src/input.ts\n+++ b/src/input.ts\n@@ -1 +1 @@\n-old\n+new\n',
    patchSha256: 'a'.repeat(64),
    createdAt: now,
    attempts: verificationRequested ? [attempt] : [],
  }
  const review = (): Record<string, unknown> => ({
    id: 'review-e2e',
    repository: {
      name: 'sample/project',
      url: 'https://github.com/sample/project',
    },
    title: 'Review sample/project',
    description: 'One actionable finding.',
    findings: [
      {
        id: 'finding-e2e',
        file: 'src/input.ts',
        line: 4,
        endLine: 4,
        title: 'Unsafe input',
        message: 'Validate this value before use.',
        impact: 'Untrusted input may be accepted.',
        evidence: 'const value = input.value;',
        severity: 'HIGH',
        category: 'SECURITY',
        suggestions: ['Validate the input.'],
        status: findingStatus,
        independentlyVerifiedAt: null,
        verificationRecords: [],
        feedback,
        assessmentFeedback,
        fixProposals: proposalSaved ? [proposal] : [],
      },
    ],
    findingLifecycleAnalytics: {
      total: 1,
      statusCounts: {
        UNREVIEWED: findingStatus === 'UNREVIEWED' ? 1 : 0,
        CONFIRMED: findingStatus === 'CONFIRMED' ? 1 : 0,
        FALSE_POSITIVE: 0,
        DUPLICATE: 0,
        FIXED: 0,
        WONT_FIX: 0,
      },
      developerMarkedFixed: 0,
      independentlyVerifiedFixed: 0,
    },
    analytics: { totalIssues: 1, qualityScore: 82 },
    chat: null,
    status: 'completed',
    branch: 'main',
    createdAt: now,
  })

  await mockApi(page, async ({ method, path, route }) => {
    if (method === 'GET' && path === '/auth/me') return json({ user: connectedUser })
    if (method === 'GET' && path === '/github/connect') {
      return json({ url: 'https://github.mock/login/oauth/authorize?state=e2e' })
    }
    if (method === 'GET' && path === '/auth/github/callback') {
      connectedUser = { ...user, githubConnected: true, githubUsername: 'e2e-developer' }
      return json({}, 302, { location: 'http://127.0.0.1:3000/github/repos?connected=true' })
    }
    if (method === 'GET' && path === '/github/repos') {
      return json([
        {
          id: 1,
          name: 'project',
          full_name: 'sample/project',
          private: false,
          language: 'TypeScript',
          updated_at: now,
        },
      ])
    }
    if (method === 'GET' && path.includes('/github/repos/sample%2Fproject/files')) {
      return json([])
    }
    if (method === 'GET' && path === '/reviews') return json(reviewStarted ? [summary] : [])
    if (method === 'GET' && path === '/reviews/review-e2e') return json(review())
    if (method === 'POST' && path === '/reviews/start') {
      reviewStarted = true
      expect(route.request().postDataJSON()).toEqual({
        repository: 'sample/project',
        branch: 'main',
      })
      return json({ reviewId: 'review-e2e' })
    }
    if (method === 'PATCH' && path === '/reviews/findings/finding-e2e/status') {
      findingStatus = route.request().postDataJSON().status
      const entry = {
        id: 'feedback-status',
        previousStatus: 'UNREVIEWED',
        status: findingStatus,
        reason: null,
        createdAt: now,
        user: { fullName: user.fullName },
      }
      feedback.push(entry)
      return json({ feedback: entry })
    }
    if (method === 'POST' && path === '/reviews/findings/finding-e2e/feedback') {
      const entry = {
        id: 'feedback-assessment',
        findingId: 'finding-e2e',
        userId: user.id,
        repositoryId: 'repo-e2e',
        requestKey: 'request-e2e',
        category: route.request().postDataJSON().category,
        explanation: null,
        createdAt: now,
        user: { fullName: user.fullName },
      }
      assessmentFeedback.push(entry)
      return json({ feedback: entry })
    }
    if (method === 'POST' && path === '/reviews/findings/finding-e2e/fix-proposals') {
      proposalSaved = true
      return json({ proposal })
    }
    if (method === 'POST' && path === '/reviews/fix-proposals/proposal-e2e/verification-attempts') {
      verificationRequested = true
      return json({ attempt })
    }
    return undefined
  })
  await page.route('https://github.mock/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<button id="authorize">Authorize AI-CodeGuard</button><script>document.querySelector("#authorize").onclick=()=>location.href="http://127.0.0.1:3001/api/auth/github/callback?code=mock&state=e2e"</script>',
    })
  })

  await page.goto('/github/repos')
  await page.getByRole('button', { name: 'Connect GitHub' }).click()
  await page.getByRole('button', { name: 'Authorize AI-CodeGuard' }).click()
  await expect(page.getByRole('heading', { name: 'GitHub repositories' })).toBeVisible()
  await page.getByRole('button', { name: 'Select for Review' }).click()
  await page.getByRole('button', { name: 'Start Review' }).click()
  await expect(page.getByText('Unsafe input')).toBeVisible()

  await page.getByLabel('Update finding status').selectOption('CONFIRMED')
  await page.getByLabel('Optional feedback reason').fill('Confirmed in the source.')
  await page.getByRole('button', { name: 'Save status' }).click()
  await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Submit feedback' }).click()
  await expect(page.getByText('No accuracy feedback submitted yet.')).toHaveCount(0)

  await page.getByLabel('Unified diff patch proposal').fill(proposal.patch)
  await page.getByRole('button', { name: 'Save patch proposal' }).click()
  await page.getByRole('button', { name: 'Request safe verification' }).click()
  await expect(page.getByText(/Needs review · BLOCKED/)).toBeVisible()
})

async function exerciseAutomationApproval(
  page: import('@playwright/test').Page,
  decision: 'approve' | 'reject'
): Promise<void> {
  let decided = false
  const now = '2026-11-04T00:00:00.000Z'
  const pendingAutomation = {
    id: 'automation-e2e',
    title: 'Review recent results',
    goal: 'Create a summary draft',
    workflowDefinition: null,
    mode: 'APPROVAL_REQUIRED',
    status: 'AWAITING_APPROVAL',
    tasks: [
      {
        id: 'task-e2e',
        key: 'collect',
        title: 'Collect review results',
        description: 'Read recent completed reviews.',
        action: 'collect_review_results',
        dependencies: [],
        output: null,
        status: 'AWAITING_APPROVAL',
        attempts: 0,
        errorMessage: null,
        executionAttempts: [],
      },
    ],
    events: [],
    approvals: [
      {
        id: 'approval-e2e',
        status: 'PENDING',
        summary: 'Read-only plan',
        payload: {
          goal: 'Create a summary draft',
          title: 'Review recent results',
          tasks: [
            {
              key: 'collect',
              title: 'Collect review results',
              description: 'Read recent completed reviews.',
              action: 'collect_review_results',
              dependencies: [],
              input: {},
            },
          ],
        },
        payloadHash: 'a'.repeat(64),
        expiresAt: '2030-01-01T00:00:00.000Z',
        decidedAt: null,
        createdAt: now,
      },
    ],
    createdAt: now,
  }

  await mockApi(page, async ({ method, path }) => {
    if (method === 'GET' && path === '/auth/me') return json({ user })
    if (method === 'GET' && path === '/automations') {
      return json(
        decided
          ? [
              {
                ...pendingAutomation,
                status: decision === 'approve' ? 'QUEUED' : 'REJECTED',
              },
            ]
          : [pendingAutomation]
      )
    }
    if (method === 'POST' && path === `/automations/automation-e2e/${decision}`) {
      decided = true
      return json({
        ...pendingAutomation,
        status: decision === 'approve' ? 'QUEUED' : 'REJECTED',
      })
    }
    return undefined
  })

  await page.goto('/automations?view=approvals')
  await expect(page.getByRole('heading', { name: 'Approval inbox' })).toBeVisible()
  if (decision === 'approve') {
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: 'Approve read-only plan' }).click()
  } else {
    await page.getByRole('button', { name: 'Reject plan' }).click()
  }
  await expect.poll(() => decided).toBe(true)
}

for (const decision of ['approve', 'reject'] as const) {
  test(`${decision}s an automation plan through the approval inbox`, async ({ page }) => {
    await exerciseAutomationApproval(page, decision)
  })
}

test('mocks Stripe checkout and routes expired sessions back to sign-in', async ({ page }) => {
  await mockApi(page, async ({ method, path }) => {
    if (method === 'GET' && path === '/auth/me') return json({ user })
    if (method === 'POST' && path === '/billing/create-checkout') {
      return json({ url: 'https://checkout.stripe.test/session/e2e' })
    }
    return undefined
  })
  await page.route('https://checkout.stripe.test/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<h1>Mock Stripe checkout</h1>',
    })
  })

  await page.goto('/pricing')
  await page.getByRole('button', { name: 'Upgrade' }).click()
  await expect(page.getByRole('heading', { name: 'Mock Stripe checkout' })).toBeVisible()

  await page.unrouteAll()
  await mockApi(page, async ({ method, path }) => {
    if (method === 'GET' && path === '/auth/me') return json({ error: 'Session expired' }, 401)
    return undefined
  })
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?returnUrl=/)
})

test('keeps login usable with keyboard focus on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')

  const email = page.getByLabel('Email')
  const password = page.getByLabel('Password', { exact: true })
  await expect(email).toBeVisible()
  await expect(password).toBeVisible()

  await email.focus()
  await page.keyboard.press('Tab')
  await expect(password).toBeFocused()
  const focusRing = await password.evaluate((element) => getComputedStyle(element).boxShadow)
  expect(focusRing).not.toBe('none')

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  )
  expect(overflow).toBe(false)
})

test('announces failed sign-in and redirects protected pages after an expired session', async ({
  page,
}) => {
  await mockApi(page, async ({ method, path }) => {
    if (method === 'POST' && path === '/auth/login') {
      return json({ error: 'Invalid email or password' }, 401)
    }
    if (method === 'GET' && path === '/auth/me') return json({ error: 'Session expired' }, 401)
    return undefined
  })
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('incorrect-e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toBeVisible()

  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?returnUrl=/)
})
