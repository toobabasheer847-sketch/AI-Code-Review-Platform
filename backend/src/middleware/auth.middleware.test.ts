import assert from 'node:assert/strict'
import test from 'node:test'
import jwt from 'jsonwebtoken'
import type { NextFunction, Request, Response } from 'express'
import { createAuthMiddleware } from './auth.middleware'
import { env } from '@/config/env'
import { generateToken } from '@/utils/jwt'

async function invokeMiddleware(
  sessionToken: string | undefined,
  currentVersion: number | null,
  isVerified = true,
  permitUnverified = false,
  authorization?: string
) {
  let statusCode: number | undefined
  let responseBody: { error: string } | undefined
  let nextError: unknown
  let nextCalled = false

  const req = {
    headers: {
      cookie: sessionToken
        ? `${env.AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`
        : undefined,
      authorization,
    },
  } as Request
  const res = {
    status(code: number) {
      statusCode = code
      return this
    },
    json(body: { error: string }) {
      responseBody = body
      return this
    },
    clearCookie() {
      return this
    },
  } as unknown as Response
  const next: NextFunction = (error?: unknown) => {
    nextCalled = error === undefined
    nextError = error
  }

  await createAuthMiddleware(
    async () =>
      currentVersion === null ? null : { tokenVersion: currentVersion, isVerified },
    { permitUnverified }
  )(req, res, next)
  return { statusCode, responseBody, nextCalled, nextError, user: req.user }
}

test('auth middleware requires a session cookie and ignores bearer authorization', async () => {
  const missing = await invokeMiddleware(undefined, 0)
  assert.equal(missing.statusCode, 401)

  const bearerOnly = await invokeMiddleware(
    undefined,
    0,
    true,
    false,
    `Bearer ${generateToken({ userId: 'user-1', email: 'person@example.com', tokenVersion: 0 })}`
  )
  assert.equal(bearerOnly.statusCode, 401)

  const malformed = await invokeMiddleware('not-a-valid-session', 0)
  assert.equal(malformed.statusCode, 401)
  assert.equal(malformed.nextCalled, false)
})

test('auth middleware rejects expired, revoked, and deleted-user sessions', async () => {
  const expired = jwt.sign(
    { userId: 'user-1', email: 'person@example.com' },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: -1 }
  )
  const valid = generateToken({
    userId: 'user-1',
    email: 'person@example.com',
    tokenVersion: 0,
  })

  assert.equal((await invokeMiddleware(valid, 1)).statusCode, 401)
  assert.equal((await invokeMiddleware(valid, null)).statusCode, 401)
  const expiredResult = await invokeMiddleware(expired, 0)
  assert.equal(expiredResult.statusCode, 401)
  assert.equal(expiredResult.nextCalled, false)
})

test('auth middleware accepts a valid session when its token version matches', async () => {
  const token = generateToken({
    userId: 'user-1',
    email: 'person@example.com',
    tokenVersion: 2,
  })
  const result = await invokeMiddleware(token, 2)
  assert.equal(result.nextCalled, true)
  assert.equal(result.user?.userId, 'user-1')
  assert.equal(result.nextError, undefined)
})

test('protected routes reject unverified users while account lifecycle routes remain available', async () => {
  const token = generateToken({
    userId: 'user-1',
    email: 'person@example.com',
    tokenVersion: 0,
  })
  const protectedResult = await invokeMiddleware(token, 0, false)
  assert.equal(protectedResult.statusCode, 403)
  assert.deepEqual(protectedResult.responseBody, { error: 'Email verification required' })
  assert.equal(protectedResult.nextCalled, false)

  const lifecycleResult = await invokeMiddleware(token, 0, false, true)
  assert.equal(lifecycleResult.nextCalled, true)
  assert.equal(lifecycleResult.user?.userId, 'user-1')
})
