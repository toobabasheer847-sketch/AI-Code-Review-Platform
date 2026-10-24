// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  reviewApi,
  type FindingFeedback,
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
  severity: 'warning',
  category: 'bug',
  suggestions: [],
  status: 'UNREVIEWED',
  independentlyVerifiedAt: null,
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
  const form = container.querySelector('form')
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
    vi.spyOn(reviewApi, 'createFixProposal').mockImplementation(async () => {
      persistedReview = {
        ...persistedReview,
        findings: [{ ...persistedReview.findings[0]!, fixProposals: [proposal] }],
      }
      return { proposal }
    })
    const container = await mountReview()

    expect(container.textContent).toContain(
      'Saving a proposal never applies it. This deployment does not execute proposals.'
    )
    await submitPatch(container, patch)
    await waitForText(container, proposal.patchSha256)
    expect(container.textContent).toContain('View patch')
    expect(container.textContent).toContain(patch)
  })
})
