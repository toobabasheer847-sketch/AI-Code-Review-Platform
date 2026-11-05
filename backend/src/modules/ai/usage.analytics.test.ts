import assert from 'node:assert/strict'
import test from 'node:test'
import { mapAIUsageGroups, ownedAIUsageWhere } from './usage.analytics'

test('scopes analytics queries and date filters to the authenticated owner', () => {
  const from = new Date('2026-10-01T00:00:00.000Z')
  const toExclusive = new Date('2026-11-01T00:00:00.000Z')
  assert.deepEqual(ownedAIUsageWhere('owner-1', { from, toExclusive }), {
    userId: 'owner-1',
    createdAt: { gte: from, lt: toExclusive },
  })
  assert.deepEqual(ownedAIUsageWhere('owner-1', { from, toExclusive }, 'personal-workspace-1'), {
    userId: 'owner-1',
    workspaceId: 'personal-workspace-1',
    createdAt: { gte: from, lt: toExclusive },
  })
})

test('maps grouped feature/model aggregates and preserves unknown totals', () => {
  const aggregate = mapAIUsageGroups(
    [
      {
        feature: 'code_review',
        _count: { _all: 4, inputTokens: 4, outputTokens: 4, estimatedCostUsd: 4 },
        _sum: {
          inputTokens: 100,
          outputTokens: 40,
          estimatedCostUsd: 0.00005,
        },
      },
      {
        feature: 'repository_qa',
        _count: { _all: 1, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        _sum: { inputTokens: null, outputTokens: null, estimatedCostUsd: null },
      },
      {
        feature: 'chat',
        _count: { _all: 2, inputTokens: 1, outputTokens: 2, estimatedCostUsd: 1 },
        _sum: { inputTokens: 75, outputTokens: 30, estimatedCostUsd: 0.00002 },
      },
    ],
    (row) => row.feature
  )

  assert.deepEqual(aggregate, [
    {
      name: 'code_review',
      requests: 4,
      inputTokens: 100,
      outputTokens: 40,
      estimatedCostUsd: 0.00005,
    },
    {
      name: 'repository_qa',
      requests: 1,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
    },
    {
      name: 'chat',
      requests: 2,
      inputTokens: null,
      outputTokens: 30,
      estimatedCostUsd: null,
    },
  ])
})
