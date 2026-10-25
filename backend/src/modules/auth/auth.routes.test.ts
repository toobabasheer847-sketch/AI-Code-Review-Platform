import assert from 'node:assert/strict'
import express from 'express'
import test from 'node:test'
import { accountActionLimiter, verificationAttemptLimiter } from './auth.routes'

async function expectRateLimit(limiter: typeof accountActionLimiter, max: number): Promise<void> {
  const app = express()
  app.post('/limited', limiter, (_req, res) => res.sendStatus(200))
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  try {
    const statuses: number[] = []
    for (let attempt = 0; attempt < max + 1; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${address.port}/limited`, {
        method: 'POST',
      })
      statuses.push(response.status)
    }
    assert.deepEqual(
      statuses,
      [...Array<number>(max).fill(200), 429]
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
}

test('limits account security requests after five attempts in the window', async () => {
  await expectRateLimit(accountActionLimiter, 5)
})

test('limits verification code submissions after ten attempts in the window', async () => {
  await expectRateLimit(verificationAttemptLimiter, 10)
})
