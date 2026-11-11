import assert from 'node:assert/strict'
import test from 'node:test'

import { reviewListLimit, toReviewListItem } from './review-list'

test('review summaries count findings without copying finding rows', () => {
  const item = toReviewListItem({
    id: 'review-1',
    status: 'completed',
    source: 'MANUAL',
    pullRequestNumber: null,
    createdAt: new Date('2026-11-11T00:00:00Z'),
    repository: { name: 'sample/project' },
    analytics: { qualityScore: 82 },
    _count: { findings: 3 },
  })
  assert.equal(item.issues, 3)
  assert.equal(item.repository, 'sample/project')
  assert.equal(item.score, 82)
  assert.equal('findings' in item, false)
  assert.equal(reviewListLimit, 100)
})
