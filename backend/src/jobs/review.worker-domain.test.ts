import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewWorkerScope } from './review.worker-domain'

test('review jobs are constrained to the queued workspace', () => {
  assert.deepEqual(reviewWorkerScope('review-1', 'workspace-a'), {
    id: 'review-1',
    workspaceId: 'workspace-a',
  })
  assert.deepEqual(reviewWorkerScope('review-1', 'workspace-b'), {
    id: 'review-1',
    workspaceId: 'workspace-b',
  })
})

test('legacy review jobs can only process personal-workspace reviews', () => {
  assert.deepEqual(reviewWorkerScope('review-1'), {
    id: 'review-1',
    workspace: { is: { isPersonal: true } },
  })
})
