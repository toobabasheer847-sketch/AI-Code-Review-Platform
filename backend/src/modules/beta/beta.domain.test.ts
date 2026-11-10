import assert from 'node:assert/strict'
import test from 'node:test'

import {
  betaLimitations,
  isBetaAdmin,
  onboardingSteps,
  parseEmailList,
  parseFeedbackDraft,
  productEventNames,
  resolveBetaStatus,
} from './beta.domain'
import { recordProductEvent, setProductEventWriter, useDefaultProductEventWriter } from './product-events'

test('beta allowlist stays open until it is configured', () => {
  assert.deepEqual(parseEmailList(undefined), [])
  assert.deepEqual(parseEmailList(' Person@Example.com, second@example.com '), [
    'person@example.com',
    'second@example.com',
  ])
  assert.equal(resolveBetaStatus('person@example.com', []), 'ACTIVE')
  assert.equal(resolveBetaStatus('person@example.com', ['person@example.com']), 'ACTIVE')
  assert.equal(resolveBetaStatus('other@example.com', ['person@example.com']), 'PENDING')
  assert.equal(isBetaAdmin('admin@example.com', []), false)
  assert.equal(isBetaAdmin(undefined, ['admin@example.com']), false)
  assert.equal(isBetaAdmin('Admin@Example.com', ['admin@example.com']), true)
})

test('feedback validation keeps product feedback short and free of secrets', () => {
  const draft = parseFeedbackDraft({
    category: 'REVIEW_QUALITY',
    subject: 'Review missed a bug',
    body: 'The summary was useful, but the suggested fix was too broad.',
    rating: 3,
    reviewId: 'review_12345678',
  })
  assert.equal(draft.rating, 3)
  assert.equal(draft.reviewId, 'review_12345678')

  assert.throws(() => parseFeedbackDraft({ category: 'BUG', subject: 'no', body: 'details' }), /Subject/)
  assert.throws(
    () => parseFeedbackDraft({ category: 'REVIEW_QUALITY', subject: 'Quality', body: 'Needs a rating' }),
    /rating/
  )
  assert.throws(
    () =>
      parseFeedbackDraft({
        category: 'BUG',
        subject: 'Connection failed',
        body: 'postgres://user:secret@localhost/ai_codeguard',
      }),
    /secrets/
  )
  assert.equal(JSON.stringify(productEventNames).includes('repository'), false)
  assert.ok(betaLimitations.some((item) => item.includes('secrets')))
})

test('onboarding steps follow workspace, GitHub, and review progress', () => {
  const steps = onboardingSteps({ workspaceCount: 0, githubConnected: true, reviewCount: 0 })
  assert.deepEqual(
    steps.map((step) => [step.id, step.complete]),
    [
      ['workspace', false],
      ['github', true],
      ['review', false],
    ]
  )
})

test('product events record only an allowlisted name', async () => {
  const recorded: Array<{ userId: string; name: string }> = []
  setProductEventWriter(async (userId, name) => {
    recorded.push({ userId, name })
  })
  try {
    await recordProductEvent('user-1', 'REPO_CHAT')
    assert.deepEqual(recorded, [{ userId: 'user-1', name: 'REPO_CHAT' }])
    assert.equal(JSON.stringify(recorded[0]).includes('snippet'), false)
  } finally {
    useDefaultProductEventWriter()
  }
})
