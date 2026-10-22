import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ReviewDetail } from '@/features/reviews/api/reviewApi'

import { ReviewDetails } from './ReviewDetails.tsx'

function renderReview(review: ReviewDetail): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ReviewDetails, { review })
    )
  )
}

function createReview(finding: ReviewDetail['findings'][number]): ReviewDetail {
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
}

describe('finding lifecycle UI', () => {
  it('shows available lifecycle controls and empty history for an unreviewed finding', () => {
    const markup = renderReview(createReview(baseFinding))

    expect(markup).toContain('Developer status')
    expect(markup).toContain('Unreviewed')
    expect(markup).toContain('value="FALSE_POSITIVE"')
    expect(markup).toContain('Optional reason or developer feedback')
    expect(markup).toContain('No developer feedback yet')
  })

  it('shows recorded feedback and separates developer-marked from independently verified fixes', () => {
    const finding: ReviewDetail['findings'][number] = {
      ...baseFinding,
      status: 'FIXED',
      independentlyVerifiedAt: '2026-10-21T12:00:00.000Z',
      feedback: [
        {
          id: 'feedback-1',
          previousStatus: 'CONFIRMED',
          status: 'FIXED',
          reason: 'Patched the boundary check.',
          createdAt: '2026-10-21T11:00:00.000Z',
          user: { fullName: 'Developer One' },
        },
      ],
    }
    const markup = renderReview(createReview(finding))

    expect(markup).toContain('Fixed (developer-marked)')
    expect(markup).toContain('Independently verified')
    expect(markup).toContain('1 developer-marked fixed · 1 independently verified')
    expect(markup).toContain('Developer One')
    expect(markup).toContain('Patched the boundary check.')
    expect(markup).toContain('Confirmed → Fixed (developer-marked)')
  })
})
