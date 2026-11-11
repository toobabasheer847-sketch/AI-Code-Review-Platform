import assert from 'node:assert/strict'
import test from 'node:test'

import { runShutdownStep } from './shutdown'

test('shutdown continues after a step finishes', async () => {
  let finished = false
  await runShutdownStep(async () => {
    finished = true
  }, 1_000)
  assert.equal(finished, true)
})

test('shutdown step fails closed when cleanup hangs', async () => {
  await assert.rejects(
    () => runShutdownStep(() => new Promise(() => undefined), 20),
    /Shutdown step timed out/
  )
})
