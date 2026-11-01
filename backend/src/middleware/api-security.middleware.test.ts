import assert from 'node:assert/strict'
import test from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import { apiSecurityMiddleware } from './api-security.middleware'
import { env } from '@/config/env'
import { createCsrfToken, isValidCsrfToken, CSRF_TOKEN_TTL_MS } from '@/modules/auth/auth-session'

async function invoke(
  options: {
    method?: string
    path?: string
    origin?: string
    csrfHeader?: string
  } = {}
) {
  let statusCode: number | undefined
  let body: unknown
  let nextCalled = false
  const headers: Record<string, string> = {}
  if (options.origin) headers.origin = options.origin
  if (options.csrfHeader) headers['x-csrf-token'] = options.csrfHeader
  const req = {
    method: options.method ?? 'POST',
    path: options.path ?? '/reviews',
    headers,
    get(name: string) {
      return headers[name.toLowerCase()]
    },
  } as unknown as Request
  const res = {
    status(code: number) {
      statusCode = code
      return this
    },
    json(value: unknown) {
      body = value
      return this
    },
  } as unknown as Response
  const next: NextFunction = () => {
    nextCalled = true
  }

  apiSecurityMiddleware(req, res, next)
  return { statusCode, body, nextCalled }
}

test('cookie-authenticated mutations require the exact trusted Origin', async () => {
  assert.equal((await invoke()).statusCode, 403)
  assert.deepEqual(
    (await invoke({ origin: 'https://attacker.example' })).body,
    { error: 'Request origin is not allowed', code: 'ORIGIN_INVALID' }
  )

  const allowedOrigin = new URL(env.FRONTEND_URL).origin
  const accepted = await invoke({ origin: allowedOrigin })
  assert.equal(accepted.statusCode, 403)
  assert.equal(accepted.nextCalled, false)
})

test('mutations require a valid signed CSRF token', async () => {
  const token = createCsrfToken()
  assert.equal(isValidCsrfToken(token), true)
  assert.equal(isValidCsrfToken(createCsrfToken(Date.now() - CSRF_TOKEN_TTL_MS - 1_000)), false)
  const allowedOrigin = new URL(env.FRONTEND_URL).origin
  const missing = await invoke({ origin: allowedOrigin })
  assert.deepEqual(missing.body, { error: 'CSRF validation failed', code: 'CSRF_INVALID' })

  const valid = await invoke({
    origin: allowedOrigin,
    csrfHeader: token,
  })
  assert.equal(valid.nextCalled, true)

  const mismatch = await invoke({
    origin: allowedOrigin,
    csrfHeader: `${token}x`,
  })
  assert.equal(mismatch.statusCode, 403)
})

test('CSRF tokens from separate browser tabs remain independently valid', async () => {
  const allowedOrigin = new URL(env.FRONTEND_URL).origin
  const firstTabToken = createCsrfToken()
  const secondTabToken = createCsrfToken()

  assert.equal(
    (await invoke({ origin: allowedOrigin, csrfHeader: firstTabToken })).nextCalled,
    true
  )
  assert.equal(
    (await invoke({ origin: allowedOrigin, csrfHeader: secondTabToken })).nextCalled,
    true
  )
})

test('safe requests and signed provider webhook paths do not use browser CSRF checks', async () => {
  assert.equal((await invoke({ method: 'GET' })).nextCalled, true)
  assert.equal((await invoke({ path: '/webhooks/github' })).nextCalled, true)
  assert.equal((await invoke({ path: '/billing/webhook' })).nextCalled, true)
})
