import assert from 'node:assert/strict'
import test from 'node:test'
import {
  submitFindingFeedbackSchema,
  type FindingFeedbackCategoryValue,
} from './finding-feedback.domain'
import {
  FindingFeedbackFindingNotFoundError,
  FindingFeedbackIdempotencyConflictError,
  FindingFeedbackService,
  InvalidFindingFeedbackError,
  type FindingFeedbackStore,
} from './finding-feedback.service'

function createFeedbackHarness() {
  const saved: Array<{
    id: string
    findingId: string
    userId: string
    repositoryId: string
    requestKey: string
    category: FindingFeedbackCategoryValue
    explanation: string | null
    createdAt: Date
    user: { fullName: string }
  }> = []
  const owned = new Map([
    ['owner-1:finding-1', { id: 'finding-1', repositoryId: 'repository-1' }],
  ])
  let createCount = 0
  const store: FindingFeedbackStore = {
    async findOwnedFinding(userId, findingId) {
      return owned.get(`${userId}:${findingId}`) ?? null
    },
    async findByRequestKey(findingId, userId, requestKey) {
      return (
        saved.find(
          (entry) =>
            entry.findingId === findingId &&
            entry.userId === userId &&
            entry.requestKey === requestKey
        ) ?? null
      )
    },
    async create(input) {
      createCount += 1
      const feedback = {
        id: `assessment-${createCount}`,
        ...input,
        createdAt: new Date('2026-10-31T12:00:00.000Z'),
        user: { fullName: 'Feedback Developer' },
      }
      saved.push(feedback)
      return feedback
    },
  }
  return {
    service: new FindingFeedbackService(store),
    saved,
    get createCount() {
      return createCount
    },
  }
}

test('validates explicit feedback categories, request keys, and bounded optional explanations', () => {
  for (const category of [
    'TRUE_POSITIVE',
    'FALSE_POSITIVE',
    'ALREADY_FIXED',
    'NEEDS_REVIEW',
  ]) {
    assert.equal(
      submitFindingFeedbackSchema.safeParse({
        requestKey: 'feedback-request-1',
        category,
      }).success,
      true
    )
  }
  assert.equal(
    submitFindingFeedbackSchema.safeParse({
      requestKey: 'feedback request with spaces',
      category: 'FALSE_POSITIVE',
    }).success,
    false
  )
  assert.equal(
    submitFindingFeedbackSchema.safeParse({
      requestKey: 'feedback-1',
      category: 'UNKNOWN',
    }).success,
    false
  )
  assert.equal(
    submitFindingFeedbackSchema.safeParse({
      requestKey: 'feedback-1',
      category: 'FALSE_POSITIVE',
      explanation: 'x'.repeat(1_001),
    }).success,
    false
  )
  assert.deepEqual(
    submitFindingFeedbackSchema.parse({
      requestKey: 'feedback-1',
      category: 'FALSE_POSITIVE',
      explanation: '  Not reproducible here.  ',
    }),
    {
      requestKey: 'feedback-1',
      category: 'FALSE_POSITIVE',
      explanation: 'Not reproducible here.',
    }
  )
})

test('stores feedback with trusted finding repository provenance and developer identity', async () => {
  const harness = createFeedbackHarness()
  const result = await harness.service.submit('owner-1', 'finding-1', {
    requestKey: 'feedback-1',
    category: 'FALSE_POSITIVE',
    explanation: 'The condition is unreachable.',
  })

  assert.equal(result.findingId, 'finding-1')
  assert.equal(result.userId, 'owner-1')
  assert.equal(result.repositoryId, 'repository-1')
  assert.equal(result.category, 'FALSE_POSITIVE')
  assert.equal(result.explanation, 'The condition is unreachable.')
  assert.equal(result.user.fullName, 'Feedback Developer')
  assert.equal(result.createdAt.toISOString(), '2026-10-31T12:00:00.000Z')
  assert.equal(harness.saved.length, 1)
})

test('rejects invalid and cross-tenant feedback without writing', async () => {
  const harness = createFeedbackHarness()
  await assert.rejects(
    harness.service.submit('owner-1', 'finding-1', { category: 'FALSE_POSITIVE' }),
    InvalidFindingFeedbackError
  )
  await assert.rejects(
    harness.service.submit('other-user', 'finding-1', {
      requestKey: 'feedback-1',
      category: 'FALSE_POSITIVE',
    }),
    FindingFeedbackFindingNotFoundError
  )
  await assert.rejects(
    harness.service.submit('owner-1', 'not-found', {
      requestKey: 'feedback-2',
      category: 'TRUE_POSITIVE',
    }),
    FindingFeedbackFindingNotFoundError
  )
  assert.equal(harness.createCount, 0)
})

test('deduplicates idempotent retries and rejects request-key reuse with changed feedback', async () => {
  const harness = createFeedbackHarness()
  const input = {
    requestKey: 'feedback-retry-1',
    category: 'FALSE_POSITIVE',
    explanation: 'Does not apply to this repository.',
  }
  const first = await harness.service.submit('owner-1', 'finding-1', input)
  const retry = await harness.service.submit('owner-1', 'finding-1', input)

  assert.equal(retry.id, first.id)
  assert.equal(harness.createCount, 1)
  assert.equal(harness.saved.length, 1)

  await assert.rejects(
    harness.service.submit('owner-1', 'finding-1', {
      ...input,
      category: 'TRUE_POSITIVE',
    }),
    FindingFeedbackIdempotencyConflictError
  )
  assert.equal(harness.createCount, 1)
})
