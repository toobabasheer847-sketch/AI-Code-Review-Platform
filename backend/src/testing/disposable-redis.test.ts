import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DisposableRedisError,
  assertDisposableRedis,
  canonicalRedisUrl,
  resolveDisposableRedisUrl,
} from './disposable-redis'

test('accepts a dedicated localhost Redis port or an isolated database', () => {
  assert.deepEqual(assertDisposableRedis('redis://127.0.0.1:6390'), {
    redisUrl: 'redis://127.0.0.1:6390',
    hostname: '127.0.0.1',
    port: 6390,
    database: 0,
  })
  assert.equal(assertDisposableRedis('redis://localhost:6380/15').database, 15)
})

test('rejects remote, application, and shared Redis targets without revealing secrets', () => {
  assert.throws(
    () => assertDisposableRedis('redis://:super-secret@db.example.com:6379/15'),
    (error: unknown) => {
      assert.ok(error instanceof DisposableRedisError)
      assert.equal(error.message.includes('super-secret'), false)
      assert.match(error.message, /localhost/)
      return true
    }
  )
  assert.throws(
    () => assertDisposableRedis('redis://127.0.0.1:6380'),
    /port 6390 or database index 1-15/
  )
  const previous = process.env.REDIS_URL
  process.env.REDIS_URL = 'redis://127.0.0.1:6380/15'
  try {
    assert.throws(
      () => assertDisposableRedis('redis://127.0.0.1:6380/15'),
      /must not be the application REDIS_URL/
    )
  } finally {
    if (previous === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = previous
  }
})

test('stays disabled until a disposable Redis URL is requested', () => {
  const previous = process.env.REDIS_INTEGRATION_URL
  delete process.env.REDIS_INTEGRATION_URL
  try {
    assert.equal(resolveDisposableRedisUrl(), undefined)
    assert.equal(canonicalRedisUrl('redis://:hidden@127.0.0.1:6390/1').includes('hidden'), false)
  } finally {
    if (previous === undefined) delete process.env.REDIS_INTEGRATION_URL
    else process.env.REDIS_INTEGRATION_URL = previous
  }
})
