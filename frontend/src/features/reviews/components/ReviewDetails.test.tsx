// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  reviewApi,
  type FindingFeedback,
  type FixVerificationAttempt,
  type FixProposal,
  type FindingStatus,
  type ReviewDetail,
} from '@/features/reviews/api/reviewApi'

import { ReviewDetails } from './ReviewDetails.tsx'

function createReview(
  finding: ReviewDetail['findings'][number] = baseFinding
): ReviewDetail {
  return {
    id: 'review-1',
    repository: { name: 'owner/repository', url: 'https://github.com/owner/repository' },
    findings: [finding],
    findingLifecycleAnalytics: {
      total: 1,
      statusCounts: {
        UNREVIEWED: finding.status === 'UNREVIEWED' ? 1 : 0,
        CONFIRMED: finding.status === 'CONFIRMED' ? 1 : 0,
        FALSE_POSITIVE: finding.status === 'FALSE_POSITIVE' ? 1 : 0,
        DUPLICATE: finding.status === 'DUPLICATE' ? 1 : 0,
        FIXED: finding.status === 'FIXED' ? 1 : 0,
        WONT_FIX: finding.status === 'WONT_FIX' ? 1 : 0,
      },
      developerMarkedFixed: finding.status === 'FIXED' ? 1 : 0,
      independentlyVerifiedFixed:
        finding.status === 'FIXED' && finding.independentlyVerifiedAt ? 1 : 0,
    },
    status: 'completed',
    branch: 'main',
    sourceRevision: 'a'.repeat(40),
    createdAt: '2026-10-22T00:00:00.000Z',
    analytics: { totalIssues: 1, qualityScore: 80 },
  }
}

const baseFinding: ReviewDetail['findings'][number] = {
  id: 'finding-1',
  file: 'src/index.ts',
  line: 10,
  title: 'Example finding',
  message: 'A potential issue.',
  impact: 'The behavior can affect callers.',
  evidence: 'throw error',
  severity: 'warning',
  category: 'bug',
  suggestions: [],
  status: 'UNREVIEWED',
  independentlyVerifiedAt: null,
  verificationRecords: [
    {
      id: 'verification-1',
      requestKey: 'ai-review:review-1',
      status: 'AI_REPORTED',
      method: 'AI_REVIEW',
      resultSummary:
        'AI-reported finding. Its cited evidence matched the retrieved source; the issue itself was not independently verified.',
      sourceRevision: 'a'.repeat(40),
      diagnosticSummary: null,
      executionOccurred: false,
      toolIdentity: null,
      exitCode: null,
      durationMs: 0,
      startedAt: '2026-10-22T00:00:00.000Z',
      completedAt: '2026-10-22T00:00:00.000Z',
      createdAt: '2026-10-22T00:00:00.000Z',
    },
  ],
  feedback: [],
  fixProposals: [],
}

let persistedReview: ReviewDetail
let roots: Root[] = []
let containers: HTMLDivElement[] = []

function ReviewHarness(): JSX.Element | null {
  const { data: review } = useQuery({
    queryKey: ['reviews', 'review-1'],
    queryFn: () => reviewApi.get('review-1'),
  })
  return review ? createElement(ReviewDetails, { review }) : null
}

async function mountReview(waitFor = 'Developer status'): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ReviewHarness)
      )
    )
  })
  await waitForText(container, waitFor)
  return container
}

async function waitForText(container: HTMLElement, text: string): Promise<void> {
  const timeout = Date.now() + 3_000
  while (Date.now() < timeout) {
    if (container.textContent?.includes(text)) return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  throw new Error(`Timed out waiting for UI text: ${text}`)
}

async function submitStatus(
  container: HTMLElement,
  status: FindingStatus,
  reason?: string
): Promise<void> {
  const select = container.querySelector<HTMLSelectElement>('#finding-status-finding-1')
  const reasonInput = container.querySelector<HTMLInputElement>('#finding-reason-finding-1')
  const form = select?.closest('form')
  expect(select).not.toBeNull()
  expect(reasonInput).not.toBeNull()
  expect(form).not.toBeNull()

  await act(async () => {
    select!.value = status
    select!.dispatchEvent(new Event('change', { bubbles: true }))
    if (reason !== undefined) {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(reasonInput, reason)
      reasonInput!.dispatchEvent(new Event('input', { bubbles: true }))
    }
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

async function submitPatch(container: HTMLElement, patch: string): Promise<void> {
  const input = container.querySelector<HTMLTextAreaElement>('#finding-patch-finding-1')
  const form = input?.closest('form')
  expect(input).not.toBeNull()
  expect(form).not.toBeNull()

  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set
    valueSetter?.call(input, patch)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  persistedReview = createReview()
  vi.spyOn(reviewApi, 'get').mockImplementation(async () => persistedReview)
})

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount()
  })
  for (const container of containers) container.remove()
  roots = []
  containers = []
  vi.restoreAllMocks()
})

describe('finding lifecycle UI', () => {
  it('labels AI findings unverified and makes clear that no independent check ran', async () => {
    const container = await mountReview()

    expect(container.textContent).toContain('AI reported · unverified')
    expect(container.textContent).toContain('AI evidence matched source; no independent check ran')
    expect(container.textContent).toContain('Impact: The behavior can affect callers.')
    expect(container.textContent).toContain(`Source revision ${'a'.repeat(12)}`)
    expect(container.querySelector('pre code')?.textContent).toBe('throw error')
  })

  it('shows generated test code as a preview without applying or executing it', async () => {
    const suggestion = {
      name: 'rejects empty input',
      code: "test('rejects empty input', () => { assert.throws(() => handle('')) })",
      explanation: 'Covers invalid input.',
      expectedBenefit: 'Adds an edge-case assertion.',
      behaviorChanging: true,
    }
    const generateSpy = vi
      .spyOn(reviewApi, 'generateTestSuggestions')
      .mockResolvedValue({
        result: {
          framework: 'node:test via tsx',
          suggestions: [suggestion],
          duplicateCount: 1,
          previewOnly: true,
        },
      })
    const container = await mountReview()
    const button = Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Generate test suggestions')
    )

    expect(container.textContent).toContain('Suggestions are not applied or executed.')
    await act(async () => button?.click())
    await waitForText(container, suggestion.code)

    expect(generateSpy).toHaveBeenCalledWith('review-1', 'finding-1')
    expect(
      Array.from(container.querySelectorAll('pre code')).some(
        (code) => code.textContent === suggestion.code
      )
    ).toBe(true)
    expect(container.textContent).toContain('Expected benefit: Adds an edge-case assertion.')
    expect(container.textContent).toContain(
      'Potential behavior change (AI assessment): yes. Review intent before any approval.'
    )
    expect(container.textContent).toContain('Omitted 1 duplicate suggestion(s).')
    expect(
      Array.from(container.querySelectorAll('button')).some((item) =>
        /apply|run|execute/i.test(item.textContent ?? '')
      )
    ).toBe(false)
  })

  it('requests only an approved profile and displays the inconclusive no-runner result', async () => {
    const verification = {
      id: 'verification-2',
      requestKey: 'check-request-2',
      status: 'INCONCLUSIVE' as const,
      method: 'STATIC_ANALYSIS',
      resultSummary: 'No isolated verification runner is configured. The requested check was not executed.',
      sourceRevision: 'a'.repeat(40),
      diagnosticSummary:
        'No sandbox runner or approved static-analysis tool is configured; no repository code was executed.',
      executionOccurred: false,
      toolIdentity: null,
      exitCode: null,
      durationMs: 0,
      startedAt: '2026-10-22T00:00:00.000Z',
      completedAt: '2026-10-22T00:00:00.000Z',
      createdAt: '2026-10-22T00:00:00.000Z',
    }
    const requestSpy = vi
      .spyOn(reviewApi, 'requestFindingVerification')
      .mockImplementation(async () => {
        persistedReview = createReview({
          ...baseFinding,
          verificationRecords: [...baseFinding.verificationRecords, verification],
        })
        return { verification }
      })
    persistedReview = createReview()
    const container = await mountReview()

    const button = Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Request independent check')
    )
    expect(button).toBeDefined()
    await act(async () => {
      button?.click()
    })

    expect(requestSpy).toHaveBeenCalledWith(
      'finding-1',
      expect.objectContaining({ method: 'STATIC_ANALYSIS' })
    )
    expect(container.textContent).toContain('Inconclusive')
    expect(container.textContent).toContain('Not executed')
    expect(container.textContent).toContain('no repository code was executed')
  })

  it('renders executed verification outcomes and tool evidence distinctly', async () => {
    const verificationStatuses = [
      { status: 'VERIFIED' as const, label: 'Independently verified', exitCode: 0 },
      { status: 'VERIFICATION_FAILED' as const, label: 'Verification failed', exitCode: 1 },
    ]

    for (const [index, outcome] of verificationStatuses.entries()) {
      persistedReview = createReview({
        ...baseFinding,
        verificationRecords: [
          {
            id: `verification-${index}`,
            requestKey: `executed-check-${index}`,
            status: outcome.status,
            method: 'TARGETED_TEST',
            resultSummary: `Controlled UI fixture for ${outcome.status}.`,
            sourceRevision: 'a'.repeat(40),
            diagnosticSummary: 'Synthetic displayed diagnostic; no repository test executed.',
            executionOccurred: true,
            toolIdentity: 'approved-check-profile@1',
            exitCode: outcome.exitCode,
            durationMs: 125,
            startedAt: '2026-10-22T00:00:00.000Z',
            completedAt: '2026-10-22T00:00:00.125Z',
            createdAt: '2026-10-22T00:00:00.125Z',
          },
        ],
      })
      const container = await mountReview()

      expect(container.textContent).toContain(outcome.label)
      expect(container.textContent).toContain('Targeted test executed')
      expect(container.textContent).toContain('approved-check-profile@1')
      expect(container.textContent).toContain(`exit ${outcome.exitCode}`)
      expect(container.textContent).toContain('Synthetic displayed diagnostic')
    }
  })

  it('does not substitute a missing heuristic score or claim clean code when no findings exist', async () => {
    persistedReview = {
      ...createReview(),
      analytics: undefined,
      findings: [],
      findingLifecycleAnalytics: {
        total: 0,
        statusCounts: {
          UNREVIEWED: 0,
          CONFIRMED: 0,
          FALSE_POSITIVE: 0,
          DUPLICATE: 0,
          FIXED: 0,
          WONT_FIX: 0,
        },
        developerMarkedFixed: 0,
        independentlyVerifiedFixed: 0,
      },
    }
    const container = await mountReview('No findings were validated for the supplied source.')

    expect(container.querySelector('.text-5xl')).toBeNull()
    expect(container.textContent).not.toContain('Heuristic review score')
    expect(container.textContent).toContain(
      'No findings were validated for the supplied source. This does not guarantee the code is free of issues.'
    )
    expect(container.textContent).not.toContain('Great code')
  })

  it('saves an optional reason and reloads persisted status and feedback history', async () => {
    const updateFindingStatus = vi
      .spyOn(reviewApi, 'updateFindingStatus')
      .mockImplementation(async (_findingId, input) => {
        const previousFinding = persistedReview.findings[0]!
        const feedback: FindingFeedback = {
          id: 'feedback-1',
          previousStatus: previousFinding.status,
          status: input.status,
          reason: input.reason ?? null,
          createdAt: '2026-10-22T12:00:00.000Z',
          user: { fullName: 'Lifecycle Developer' },
        }
        persistedReview = {
          ...persistedReview,
          findings: [
            {
              ...previousFinding,
              status: input.status,
              feedback: [...previousFinding.feedback, feedback],
            },
          ],
          findingLifecycleAnalytics: {
            ...persistedReview.findingLifecycleAnalytics,
            statusCounts: {
              ...persistedReview.findingLifecycleAnalytics.statusCounts,
              [previousFinding.status]:
                persistedReview.findingLifecycleAnalytics.statusCounts[previousFinding.status] - 1,
              [input.status]:
                persistedReview.findingLifecycleAnalytics.statusCounts[input.status] + 1,
            },
          },
        }
        return { feedback }
      })
    const container = await mountReview()

    expect(container.textContent).toContain('Unreviewed')
    expect(container.textContent).toContain('No developer feedback yet')
    await submitStatus(container, 'FALSE_POSITIVE', 'Not reproducible in this branch.')
    await waitForText(container, 'Not reproducible in this branch.')

    expect(updateFindingStatus).toHaveBeenCalledWith('finding-1', {
      status: 'FALSE_POSITIVE',
      reason: 'Not reproducible in this branch.',
    })
    expect(container.textContent).toContain('False positive')
    expect(container.textContent).toContain('Lifecycle Developer')

    const readsBeforeRefresh = vi.mocked(reviewApi.get).mock.calls.length
    const refreshedContainer = await mountReview()
    expect(vi.mocked(reviewApi.get).mock.calls.length).toBeGreaterThan(readsBeforeRefresh)
    expect(refreshedContainer.textContent).toContain('False positive')
    expect(refreshedContainer.textContent).toContain('Lifecycle Developer')
    expect(refreshedContainer.textContent).toContain('Not reproducible in this branch.')
  })

  it('shows save errors and leaves the persisted status and history unchanged', async () => {
    vi.spyOn(reviewApi, 'updateFindingStatus').mockRejectedValue(
      new Error('Finding status could not be saved.')
    )
    const container = await mountReview()

    await submitStatus(container, 'CONFIRMED', 'Review reason.')
    await waitForText(container, 'Finding status could not be saved.')

    expect(container.textContent).toContain('Unreviewed')
    expect(container.textContent).toContain('No developer feedback yet')
    expect(persistedReview.findings[0]?.status).toBe('UNREVIEWED')
  })

  it('distinguishes developer-fixed findings from persisted independent verification', async () => {
    persistedReview = createReview({
      ...baseFinding,
      status: 'FIXED',
      feedback: [],
      independentlyVerifiedAt: null,
    })
    const container = await mountReview()

    expect(container.textContent).toContain('1 developer-marked fixed · 0 independently verified')
    expect(container.textContent).toContain('Not independently verified')
  })

  it('saves and displays an exact reviewable patch proposal without executing it', async () => {
    const patch = [
      'diff --git a/src/index.ts b/src/index.ts',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1 +1 @@',
      '-old()',
      '+new()',
    ].join('\n')
    const proposal: FixProposal = {
      id: 'proposal-1',
      patch,
      patchSha256: 'a'.repeat(64),
      createdAt: '2026-10-22T12:00:00.000Z',
      attempts: [],
    }
    const attempt: FixVerificationAttempt = {
      id: 'attempt-1',
      patchSha256: proposal.patchSha256,
      status: 'INCONCLUSIVE',
      executionStatus: 'BLOCKED',
      testCommands: [],
      testsPassed: null,
      originalIssueReproducedBefore: null,
      originalIssueReproducedAfter: null,
      startedAt: '2026-10-22T12:01:00.000Z',
      completedAt: '2026-10-22T12:01:00.000Z',
      sanitizedLogs:
        'No isolated verification runner is configured; the patch was not executed.',
    }
    vi.spyOn(reviewApi, 'createFixProposal').mockImplementation(async () => {
      persistedReview = {
        ...persistedReview,
        findings: [{ ...persistedReview.findings[0]!, fixProposals: [proposal] }],
      }
      return { proposal }
    })
    vi.spyOn(reviewApi, 'verifyFixProposal').mockImplementation(async () => {
      persistedReview = {
        ...persistedReview,
        findings: [
          {
            ...persistedReview.findings[0]!,
            fixProposals: [{ ...proposal, attempts: [attempt] }],
          },
        ],
      }
      return { attempt }
    })
    const container = await mountReview()

    expect(container.textContent).toContain(
      'Without an isolated runner, verification requests are marked Needs review'
    )
    await submitPatch(container, patch)
    await waitForText(container, proposal.patchSha256)
    expect(container.textContent).toContain('View patch')
    expect(container.textContent).toContain(patch)

    const verifyButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Request safe verification')
    )
    expect(verifyButton).toBeDefined()
    await act(async () => verifyButton?.click())
    await waitForText(container, 'No isolated verification runner is configured')

    expect(reviewApi.verifyFixProposal).toHaveBeenCalledWith(
      proposal.id,
      expect.objectContaining({ requestKey: expect.any(String) })
    )
    expect(container.textContent).toContain('Needs review')
    expect(container.textContent).toContain('Tests not run')
  })
})
