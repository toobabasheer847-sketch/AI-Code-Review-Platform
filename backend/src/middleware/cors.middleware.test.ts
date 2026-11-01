import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import test from 'node:test'
import { corsMiddleware } from './cors.middleware'
import { env } from '@/config/env'

test('CORS enables credentials only for the configured frontend origin', async (context) => {
  const app = express()
  app.use(corsMiddleware)
  app.get('/api/test', (_req, res) => res.json({ ok: true }))
  const server = app.listen(0)
  await once(server, 'listening')
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  )

  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const endpoint = `http://127.0.0.1:${address.port}/api/test`
  const allowedOrigin = new URL(env.FRONTEND_URL).origin
  const allowed = await fetch(endpoint, { headers: { Origin: allowedOrigin } })
  assert.equal(allowed.headers.get('access-control-allow-origin'), allowedOrigin)
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true')

  const rejected = await fetch(endpoint, {
    headers: { Origin: 'https://attacker.example' },
  })
  assert.equal(rejected.headers.get('access-control-allow-origin'), null)
})
