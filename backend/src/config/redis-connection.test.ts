import assert from 'node:assert/strict'
import test from 'node:test'

import { getRedisConnectionTarget } from './redis-connection'

test('resolves the Windows-host Docker Redis endpoint without credentials', () => {
  assert.deepEqual(getRedisConnectionTarget('redis://127.0.0.1:6380'), {
    host: '127.0.0.1',
    port: 6380,
  })
})

test('resolves the Compose Redis service endpoint', () => {
  assert.deepEqual(getRedisConnectionTarget('redis://redis:6379'), {
    host: 'redis',
    port: 6379,
  })
})

test('does not include credentials in the resolved target', () => {
  assert.deepEqual(getRedisConnectionTarget('redis://user:password@127.0.0.1:6380'), {
    host: '127.0.0.1',
    port: 6380,
  })
})

test('rejects malformed Redis URLs without exposing their contents', () => {
  assert.throws(
    () => getRedisConnectionTarget('not-a-redis-url-with-a-secret'),
    { message: 'REDIS_URL must be a valid Redis connection URL' }
  )
})
