// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { repositoryApi } from '@/features/repositories/api/repositoryApi'
import { reviewApi, type FeedbackAnalytics } from '@/features/reviews/api/reviewApi'

import { FeedbackAnalyticsPage } from './FeedbackAnalyticsPage.tsx'

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useMe: () => ({ data: { fullName: 'Ada Lovelace' } }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/features/repositories/api/repositoryApi', () => ({
  repositoryApi: { list: vi.fn() },
}))

vi.mock('@/features/reviews/api/reviewApi', () => ({
  reviewApi: { getFeedbackAnalytics: vi.fn() },
}))

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => children ?? null,
  LineChart: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  Line: () => null,
  BarChart: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  CartesianGrid: () => null,
}))

const repository = {
  id: 'repo-1',
  name: 'octo/example',
  url: 'https://github.com/octo/example',
  language: 'TypeScript',
  createdAt: '2026-10-01T00:00:00.000Z',
}

function analytics(overrides: Partial<FeedbackAnalytics> = {}): FeedbackAnalytics {
  return {
    filters: { from: null, to: null, repositoryId: 'repo-1' },
    distinctions: {
      userAssessments: 'User assessments are developer judgments.',
      objectiveVerification: 'Only VERIFIED records are objective ground truth.',
      unassessedFindings: 'Unassessed findings are not confirmed true or false positives.',
      verificationFailure: 'A failed verification is not a confirmed false positive.',
      verifiedFix: 'An independently verified fix is not a true positive.',
      duplicateCandidates: 'Duplicate candidates stay for human review.',
    },
    findings: {
      total: 1,
      userAssessedTruePositives: 1,
      userAssessedFalsePositives: 0,
      alreadyFixed: 0,
      needsReview: 0,
      unassessed: 0,
    },
    rates: null,
    ratesWithheldReason:
      'Percentages are withheld because only 1 finding has user assessments. At least 5 assessed findings are required.',
    objectiveVerification: {
      verified: 0,
      verificationFailed: 0,
      inconclusive: 0,
      aiReportedOnly: 1,
      independentlyVerifiedFixes: 0,
      unreviewedAiFindingsAreConfirmed: false,
    },
    distributionBySeverity: [],
    distributionByCategory: [],
    trends: { basis: 'assessment_events', note: 'Events are counted separately.', points: [] },
    reviewTrends: [],
    repositoryTrend: {
      reviewCount: 0,
      scoredReviewCount: 0,
      qualityScoreAverage: null,
      qualityScoreAverageWithheldReason: 'The repository quality-score average is withheld.',
      totalFindings: 1,
      rates: null,
      ratesWithheldReason: null,
    },
    duplicateCandidates: [],
    ruleSuggestions: [],
    ...overrides,
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(path: string): void {
  act(() => root?.unmount())
  container?.remove()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <FeedbackAnalyticsPage />
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

beforeEach(() => {
  vi.mocked(repositoryApi.list).mockReset()
  vi.mocked(reviewApi.getFeedbackAnalytics).mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('feedback analytics page', () => {
  it('shows a loading state while analytics are requested', async () => {
    vi.mocked(repositoryApi.list).mockResolvedValue([repository])
    vi.mocked(reviewApi.getFeedbackAnalytics).mockReturnValue(new Promise(() => undefined))
    render('/analytics?repositoryId=repo-1')
    await settle()
    expect(document.body.textContent).toContain('Loading feedback analytics...')
  })

  it('shows an error state with a retry action', async () => {
    vi.mocked(repositoryApi.list).mockResolvedValue([repository])
    vi.mocked(reviewApi.getFeedbackAnalytics).mockRejectedValue({
      response: { data: { error: 'Repository not found' } },
    })
    render('/analytics?repositoryId=repo-1')
    await settle()
    expect(document.body.textContent).toContain('Repository not found')
    expect(document.body.textContent).toContain('Try again')
  })

  it('shows an empty state when the repository has no findings', async () => {
    vi.mocked(repositoryApi.list).mockResolvedValue([repository])
    vi.mocked(reviewApi.getFeedbackAnalytics).mockResolvedValue(
      analytics({
        findings: {
          total: 0,
          userAssessedTruePositives: 0,
          userAssessedFalsePositives: 0,
          alreadyFixed: 0,
          needsReview: 0,
          unassessed: 0,
        },
      })
    )
    render('/analytics?repositoryId=repo-1')
    await settle()
    expect(document.body.textContent).toContain('No findings in this range')
    expect(document.body.textContent).not.toContain('100%')
  })

  it('withholds percentages for a small assessment sample', async () => {
    vi.mocked(repositoryApi.list).mockResolvedValue([repository])
    vi.mocked(reviewApi.getFeedbackAnalytics).mockResolvedValue(analytics())
    render('/analytics?repositoryId=repo-1')
    await settle()
    expect(document.body.textContent).toContain('Percentages are withheld')
    expect(document.body.textContent).toContain('User-assessed true positives')
    expect(document.body.textContent).not.toContain('100%')
  })
})
