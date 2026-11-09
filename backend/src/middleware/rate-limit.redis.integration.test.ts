import assert from 'node:assert/strict'
import express, { type Express, type Request } from 'express'
import { createClient } from 'redis'
import test from 'node:test'
import { createDisposableRedisClient, resolveDisposableRedisUrl } from '@/testing/disposable-redis'
import { createDistributedRateLimiter, rateLimitPolicies } from './rate-limit'
import { RateLimitUnavailableError, RedisRateLimitStore } from './rate-limit.redis'

const redisUrl = process.env.REDIS_INTEGRATION_URL?.trim()
  ? resolveDisposableRedisUrl()
  : undefined
const runId = `itest-${Date.now().toString(36)}`

function attachUser(req: Request): void {
  const userId = req.header('x-user')
  if (userId) req.user = { userId, email: `${userId}@example.test` }
}

async function listen(app: Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

async function request(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
  method = 'GET'
): Promise<{ status: number }> {
  const response = await fetch(`${baseUrl}${path}`, { headers, method })
  return { status: response.status }
}

test(
  'shares rate limits, expiry, concurrency, isolation, and recovery on disposable Redis',
  { skip: redisUrl ? false : 'Set REDIS_INTEGRATION_URL to a localhost disposable Redis.' },
  async (t) => {
    assert.ok(redisUrl)
    const redis = createDisposableRedisClient(redisUrl)
    await redis.connect()
    t.after(async () => {
      await redis.connect()
      await redis.deleteByPrefix(`rl:${runId}`)
      await redis.disconnect()
    })

    await t.test('two application instances share one counter', async () => {
      const policy = {
        ...rateLimitPolicies.api,
        name: `${runId}-shared`,
        limit: 2,
        windowMs: 60_000,
      }
      const firstApp = express()
      firstApp.set('trust proxy', false)
      firstApp.use(createDistributedRateLimiter(policy, redis))
      firstApp.get('/', (_req, res) => res.sendStatus(204))
      const secondApp = express()
      secondApp.set('trust proxy', false)
      secondApp.use(createDistributedRateLimiter(policy, redis))
      secondApp.get('/', (_req, res) => res.sendStatus(204))
      const first = await listen(firstApp)
      const second = await listen(secondApp)
      try {
        assert.equal((await request(first.baseUrl, '/')).status, 204)
        assert.equal((await request(second.baseUrl, '/')).status, 204)
        assert.equal((await request(first.baseUrl, '/')).status, 429)
      } finally {
        await first.close()
        await second.close()
      }
    })

    await t.test('expires a rate limit key after its window', async () => {
      const store = new RedisRateLimitStore(`${runId}-expire`, 'fail-closed', () => redis)
      store.windowMs = 300
      assert.equal((await store.increment('ip:127.0.0.1')).totalHits, 1)
      const key = store.prefixKey('ip:127.0.0.1')
      assert.equal(await redis.readKey(key), '1')
      await new Promise((resolve) => setTimeout(resolve, 500))
      assert.equal(await redis.readKey(key), null)
      assert.equal((await store.increment('ip:127.0.0.1')).totalHits, 1)
    })

    await t.test('counts concurrent increments without losing a request', async () => {
      const store = new RedisRateLimitStore(`${runId}-concurrent`, 'fail-closed', () => redis)
      store.windowMs = 60_000
      const results = await Promise.all(
        Array.from({ length: 20 }, () => store.increment('user:concurrent'))
      )
      assert.deepEqual(
        results.map((result) => result.totalHits).sort((left, right) => left - right),
        Array.from({ length: 20 }, (_value, index) => index + 1)
      )
    })

    await t.test('isolates users and does not let a workspace header bypass the user limit', async () => {
      const policy = {
        ...rateLimitPolicies.workspaceInvitationEmail,
        name: `${runId}-invitation`,
        limit: 1,
        windowMs: 60_000,
      }
      const app = express()
      app.set('trust proxy', false)
      app.use((req, _res, next) => {
        attachUser(req)
        next()
      })
      app.use(createDistributedRateLimiter(policy, redis))
      app.post('/invite', (_req, res) => res.sendStatus(201))
      const server = await listen(app)
      try {
        const first = await request(server.baseUrl, '/invite', {
          'x-user': 'workspace-owner-a',
          'x-workspace-id': 'workspace-a',
        }, 'POST')
        const switchedWorkspace = await request(server.baseUrl, '/invite', {
          'x-user': 'workspace-owner-a',
          'x-workspace-id': 'workspace-b',
        }, 'POST')
        const otherUser = await request(server.baseUrl, '/invite', {
          'x-user': 'workspace-owner-b',
          'x-workspace-id': 'workspace-a',
        }, 'POST')
        assert.equal(first.status, 201)
        assert.equal(switchedWorkspace.status, 429)
        assert.equal(otherUser.status, 201)
      } finally {
        await server.close()
      }
    })

    await t.test('fails closed when Redis is unreachable and recovers on the same key', async () => {
      const closed = createClient({
        url: 'redis://127.0.0.1:1',
        socket: {
          connectTimeout: 400,
          reconnectStrategy: () => new Error('Disposable Redis reconnect is disabled'),
        },
      })
      closed.on('error', () => undefined)
      await assert.rejects(() => closed.connect())
      const unreachable = new RedisRateLimitStore(`${runId}-closed`, 'fail-closed', () => ({
        async evalScript(script, keys, args) {
          return closed.eval(script, { keys, arguments: args })
        },
      }))
      await assert.rejects(
        () => unreachable.increment('user:closed'),
        (error: unknown) => error instanceof RateLimitUnavailableError
      )
      const openStore = new RedisRateLimitStore(`${runId}-closed`, 'fail-open', () => ({
        async evalScript() {
          throw new Error('Redis connection refused')
        },
      }))
      assert.equal((await openStore.increment('user:closed')).totalHits, 1)

      const recovering = new RedisRateLimitStore(`${runId}-recover`, 'fail-closed', () => redis)
      recovering.windowMs = 60_000
      assert.equal((await recovering.increment('user:recover')).totalHits, 1)
      await redis.disconnect()
      await assert.rejects(
        () => recovering.increment('user:recover'),
        (error: unknown) => error instanceof RateLimitUnavailableError
      )
      await redis.connect()
      assert.equal((await recovering.increment('user:recover')).totalHits, 2)
    })
  }
)
