import assert from 'node:assert/strict'
import test from 'node:test'

import { assertLoadTarget, percentile } from './load-profile'

test('latency percentiles use the collected samples only', () => {
  assert.equal(percentile([], 0.5), null)
  assert.equal(percentile([30, 10, 20], 0.5), 20)
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40)
  assert.equal(percentile([5], 0.99), 5)
})

test('load targets stay on localhost unless a remote staging URL is explicitly allowed', () => {
  assert.equal(assertLoadTarget('http://127.0.0.1:3001/health/live').hostname, '127.0.0.1')
  assert.throws(() => assertLoadTarget('https://api.example.com/health'), /explicit HTTPS staging/)
  assert.equal(
    assertLoadTarget('https://staging.example.com/health/live', true).hostname,
    'staging.example.com'
  )
  assert.throws(
    () => assertLoadTarget('https://api.production.example.com/health', true),
    /production hostname/
  )
  assert.throws(() => assertLoadTarget('http://user:secret@127.0.0.1/health'), /credentials/)
})
