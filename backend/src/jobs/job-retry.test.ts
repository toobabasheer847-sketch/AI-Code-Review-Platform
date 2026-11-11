import assert from 'node:assert/strict'
import test from 'node:test'

import { isTerminalQueueFailure } from './job-retry'

test('queue retries stay non-terminal until the configured attempt is exhausted', () => {
  assert.equal(isTerminalQueueFailure(1, 3), false)
  assert.equal(isTerminalQueueFailure(2, 3), false)
  assert.equal(isTerminalQueueFailure(3, 3), true)
  assert.equal(isTerminalQueueFailure(1, undefined), true)
})
