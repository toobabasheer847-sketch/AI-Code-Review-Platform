import assert from 'node:assert/strict'
import test from 'node:test'
import { AIRequestStatus } from '@prisma/client'
import {
  buildAIUsageUpsert,
  calculateEstimatedCost,
  getModelVersion,
  getConfiguredAIModel,
  runTrackedAIRequest,
  type AIUsageWrite,
} from './usage.service'

const context = {
  userId: 'owner-1',
  feature: 'code_review' as const,
  reviewId: 'review-1',
  requestKey: 'review-attempt-1',
}

test('persists provider token usage, model version, status, and request duration', async () => {
  const writes: AIUsageWrite[] = []
  const value = await runTrackedAIRequest(
    context,
    'gpt-4o-mini',
    async () => ({
      value: 'complete',
      modelVersion: '2024-07-18',
      usage: { inputTokens: 120, outputTokens: 35, totalTokens: 155 },
    }),
    async (write) => { writes.push(write) }
  )

  assert.equal(value, 'complete')
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.context.reviewId, 'review-1')
  assert.equal(writes[0]?.modelVersion, '2024-07-18')
  assert.deepEqual(writes[0]?.usage, { inputTokens: 120, outputTokens: 35, totalTokens: 155 })
  assert.equal(writes[0]?.status, AIRequestStatus.SUCCEEDED)
  assert.equal(writes[0]?.errorCategory, null)
  assert.ok((writes[0]?.durationMs ?? -1) >= 0)
  const saved = writes[0]
  assert.ok(saved)
  const upsert = buildAIUsageUpsert(saved)
  assert.deepEqual(
    {
      inputTokens: upsert.create.inputTokens,
      outputTokens: upsert.create.outputTokens,
      totalTokens: upsert.create.totalTokens,
    },
    { inputTokens: 120, outputTokens: 35, totalTokens: 155 }
  )
})

test('leaves unavailable provider token values unknown', async () => {
  const writes: AIUsageWrite[] = []
  await runTrackedAIRequest(
    context,
    'gpt-4o-mini',
    async () => ({ value: 'result' }),
    async (write) => { writes.push(write) }
  )
  assert.deepEqual(writes[0]?.usage, {})
  const saved = writes[0]
  assert.ok(saved)
  const upsert = buildAIUsageUpsert(saved)
  assert.equal(upsert.create.inputTokens, null)
  assert.equal(upsert.create.outputTokens, null)
  assert.equal(upsert.create.totalTokens, null)
  assert.equal(upsert.create.estimatedCostUsd, null)
  assert.equal(
    calculateEstimatedCost('gpt-4o-mini', {}, {
      inputUsdPerMillion: 0.15,
      outputUsdPerMillion: 0.6,
    }),
    null
  )
})

test('calculates cost only from known input and output tokens and explicit rates', () => {
  assert.equal(
    calculateEstimatedCost(
      'gpt-4o-mini',
      { inputTokens: 1_000_000, outputTokens: 500_000 },
      { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 }
    ),
    0.45
  )
  assert.equal(
    calculateEstimatedCost(
      'gpt-4o-mini',
      { inputTokens: 1_000_000, outputTokens: -1 },
      { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 }
    ),
    null
  )
})

test('validates model identifiers through the shared configuration', () => {
  assert.equal(getConfiguredAIModel('gpt-4o-mini'), 'gpt-4o-mini')
  assert.throws(() => getConfiguredAIModel(' model with spaces '), /valid model identifier/)
})

test('extracts provider-reported model versions when available', () => {
  assert.equal(getModelVersion('gpt-4o-mini', 'gpt-4o-mini-2024-07-18'), '2024-07-18')
  assert.equal(getModelVersion('gpt-4o-mini', 'gpt-4o-mini'), null)
})

test('records provider failures without storing provider error messages', async () => {
  const writes: AIUsageWrite[] = []
  const failure = Object.assign(new Error('private provider response body'), { status: 429 })
  await assert.rejects(
    runTrackedAIRequest(
      context,
      'gpt-4o-mini',
      async () => { throw failure },
      async (write) => { writes.push(write) }
    ),
    (error: unknown) => error === failure
  )

  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.status, AIRequestStatus.FAILED)
  assert.equal(writes[0]?.errorCategory, 'rate_limited')
  assert.deepEqual(writes[0]?.usage, {})
  assert.equal(JSON.stringify(writes[0]).includes('private provider response body'), false)
})

test('uses owner-scoped idempotency keys for retry upserts', () => {
  const base: AIUsageWrite = {
    context,
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    modelVersion: null,
    usage: {},
    durationMs: 1,
    status: AIRequestStatus.FAILED,
    errorCategory: 'timeout',
  }
  const retry = buildAIUsageUpsert({ ...base, status: AIRequestStatus.SUCCEEDED })
  const original = buildAIUsageUpsert(base)
  assert.deepEqual(original.where, retry.where)
  assert.equal(original.where.userId_idempotencyKey.userId, 'owner-1')
  assert.match(original.where.userId_idempotencyKey.idempotencyKey, /^[a-f0-9]{64}$/)
  assert.equal(original.create.reviewId, 'review-1')

  const otherOwner = buildAIUsageUpsert({
    ...base,
    context: { ...context, userId: 'owner-2' },
  })
  assert.notDeepEqual(otherOwner.where, original.where)
})

test('scopes AI usage idempotency to the active workspace', () => {
  const base: AIUsageWrite = {
    context: { ...context, requestKey: 'same-request' },
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    modelVersion: null,
    usage: {},
    durationMs: 1,
    status: AIRequestStatus.SUCCEEDED,
    errorCategory: null,
  }
  const workspaceA = buildAIUsageUpsert({
    ...base,
    context: { ...base.context, workspaceId: 'workspace-a' },
  })
  const workspaceB = buildAIUsageUpsert({
    ...base,
    context: { ...base.context, workspaceId: 'workspace-b' },
  })

  assert.equal(workspaceA.create.workspaceId, 'workspace-a')
  assert.notDeepEqual(workspaceA.where, workspaceB.where)
})
