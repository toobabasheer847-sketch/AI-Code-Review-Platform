import assert from 'node:assert/strict'
import express from 'express'
import test from 'node:test'
import { accountActionLimiter } from './auth.routes'

test('limits account security requests after five attempts in the window', async () => {
  const app = express()
  app.post('/password-reset', accountActionLimiter, (_req, res) => res.sendStatus(200))
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  try {
    const statuses: number[] = []
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${address.port}/password-reset`, {
        method: 'POST',
      })
      statuses.push(response.status)
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})
