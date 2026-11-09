import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import test from 'node:test'
import OpenAI from 'openai'
import { AIRequestStatus } from '@prisma/client'
import { calculateEstimatedCost, runTrackedAIRequest, type AIUsageWrite } from '@/modules/ai/usage.service'
import { integrationOptIn, readOpenAIIntegrationKey } from '@/testing/provider-test-env'

const context = {
  userId: 'integration-user',
  workspaceId: 'integration-workspace',
  feature: 'chat' as const,
  requestKey: 'openai-integration',
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return address.port
}

function capture(): { writes: AIUsageWrite[]; write: (write: AIUsageWrite) => Promise<void> } {
  const writes: AIUsageWrite[] = []
  return {
    writes,
    async write(write) {
      writes.push(write)
    },
  }
}

test('records a local OpenAI rate-limit response without calling the live API', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(429, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'rate limit', type: 'rate_limit_error' } }))
  })
  const port = await listen(server)
  const recorded = capture()
  const apiKey = 'local-rate-limit-key-not-a-secret'
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: `http://127.0.0.1:${port}/v1`,
      timeout: 2_000,
      maxRetries: 0,
    })
    await assert.rejects(() =>
      runTrackedAIRequest(
        context,
        'gpt-4o-mini',
        async () => {
          const completion = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ok' }],
          })
          return { value: completion }
        },
        recorded.write
      )
    )
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
  assert.equal(recorded.writes.length, 1)
  assert.equal(recorded.writes[0]?.status, AIRequestStatus.FAILED)
  assert.equal(recorded.writes[0]?.errorCategory, 'rate_limited')
  assert.equal(JSON.stringify(recorded.writes).includes(apiKey), false)
})

test('records timeout and connection failure without exposing the local key', async () => {
  const hanging = createServer(() => undefined)
  const port = await listen(hanging)
  const apiKey = 'local-timeout-key-not-a-secret'
  const timeoutRecord = capture()
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: `http://127.0.0.1:${port}/v1`,
      timeout: 200,
      maxRetries: 0,
    })
    await assert.rejects(() =>
      runTrackedAIRequest(
        context,
        'gpt-4o-mini',
        () =>
          client.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ok' }],
          }),
        timeoutRecord.write
      )
    )
  } finally {
    await new Promise<void>((resolve, reject) => hanging.close((error) => (error ? reject(error) : resolve())))
  }
  assert.equal(timeoutRecord.writes[0]?.errorCategory, 'timeout')
  assert.equal(JSON.stringify(timeoutRecord.writes).includes(apiKey), false)

  const offline = capture()
  const offlineClient = new OpenAI({
    apiKey,
    baseURL: 'http://127.0.0.1:1/v1',
    timeout: 400,
    maxRetries: 0,
  })
  await assert.rejects(() =>
    runTrackedAIRequest(
      context,
      'gpt-4o-mini',
      () =>
        offlineClient.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ok' }],
        }),
      offline.write
    )
  )
  assert.equal(offline.writes[0]?.status, AIRequestStatus.FAILED)
  assert.equal(JSON.stringify(offline.writes).includes(apiKey), false)
})

test('prices a minimal successful usage record without writing to the application database', () => {
  const cost = calculateEstimatedCost(
    'gpt-4o-mini',
    { inputTokens: 8, outputTokens: 1 },
    { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 }
  )
  assert.equal(cost, (8 * 0.15 + 1 * 0.6) / 1_000_000)
})

function dedicatedOpenAIKey(): { key?: string; skip: string | false } {
  if (!integrationOptIn('RUN_OPENAI_INTEGRATION_TEST')) {
    return { skip: 'Set RUN_OPENAI_INTEGRATION_TEST=1 and OPENAI_INTEGRATION_API_KEY. The application key is not used.' }
  }
  try {
    const key = readOpenAIIntegrationKey()
    return key
      ? { key, skip: false }
      : { skip: 'Set OPENAI_INTEGRATION_API_KEY to a dedicated key. The application key is not used.' }
  } catch (error) {
    return { skip: error instanceof Error ? error.message : 'The dedicated OpenAI key was rejected.' }
  }
}

const dedicatedKey = dedicatedOpenAIKey()

test(
  'rejects an invalid OpenAI API key',
  { skip: integrationOptIn('RUN_OPENAI_INTEGRATION_TEST') ? false : 'Set RUN_OPENAI_INTEGRATION_TEST=1 to call OpenAI.' },
  async () => {
    const apiKey = 'sk-invalid-integration-key-000000'
    const recorded = capture()
    const client = new OpenAI({ apiKey, timeout: 15_000, maxRetries: 0 })
    await assert.rejects(() =>
      runTrackedAIRequest(
        context,
        'gpt-4o-mini',
        () =>
          client.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ok' }],
          }),
        recorded.write
      )
    )
    assert.equal(recorded.writes[0]?.errorCategory, 'authentication')
    assert.equal(JSON.stringify(recorded.writes).includes(apiKey), false)
  }
)

test(
  'completes one minimal tracked OpenAI request',
  { skip: dedicatedKey.skip },
  async () => {
    assert.ok(dedicatedKey.key)
    const recorded = capture()
    const client = new OpenAI({ apiKey: dedicatedKey.key, timeout: 20_000, maxRetries: 0 })
    const value = await runTrackedAIRequest(
      context,
      'gpt-4o-mini',
      async () => {
        const completion = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 1,
          temperature: 0,
          messages: [{ role: 'user', content: 'Reply with ok' }],
        })
        return {
          value: completion.choices[0]?.message.content ?? '',
          modelVersion: completion.model,
          usage: {
            inputTokens: completion.usage?.prompt_tokens,
            outputTokens: completion.usage?.completion_tokens,
            totalTokens: completion.usage?.total_tokens,
          },
        }
      },
      recorded.write
    )
    assert.equal(typeof value, 'string')
    assert.equal(recorded.writes[0]?.status, AIRequestStatus.SUCCEEDED)
    assert.equal((recorded.writes[0]?.usage.totalTokens ?? 0) > 0, true)
    assert.equal(JSON.stringify(recorded.writes).includes(dedicatedKey.key), false)
  }
)
