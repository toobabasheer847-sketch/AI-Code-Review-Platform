import assert from 'node:assert/strict'
import test from 'node:test'
import jwt from 'jsonwebtoken'
import type { NextFunction, Request, Response } from 'express'
import { createAuthMiddleware } from './auth.middleware'
import { env } from '@/config/env'
import { generateToken } from '@/utils/jwt'

async function invokeMiddleware(
  authorization: string | undefined,
  currentVersion: number | null
) {
  let statusCode: number | undefined
  let responseBody: { error: string } | undefined
  let nextError: unknown
  let nextCalled = false

  const req = { headers: { authorization } } as Request
  const res = {
    status(code: number) {
      statusCode = code
      return this
    },
    json(body: { error: string }) {
      responseBody = body
      return this
    },
  } as unknown as Response
  const next: NextFunction = (error?: unknown) => {
    nextCalled = error === undefined
    nextError = error
  }

  await createAuthMiddleware(async () => currentVersion)(req, res, next)
  return { statusCode, responseBody, nextCalled, nextError, user: req.user }
}

test('auth middleware rejects missing and malformed bearer tokens', async () => {
  const missing = await invokeMiddleware(undefined, 0)
  assert.equal(missing.statusCode, 401)

  const malformed = await invokeMiddleware('Bearer not-a-jwt', 0)
  assert.equal(malformed.statusCode, 401)
  assert.equal(malformed.nextCalled, false)
})

test('auth middleware rejects expired, revoked, and deleted-user tokens', async () => {
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
  const revoked = await invokeMiddleware(`Bearer ${valid}`, 1)
  assert.equal(revoked.statusCode, 401)

  const deleted = await invokeMiddleware(`Bearer ${valid}`, null)
  assert.equal(deleted.statusCode, 401)

  const expiredResult = await invokeMiddleware(`Bearer ${expired}`, 0)
  assert.equal(expiredResult.statusCode, 401)
  assert.equal(expiredResult.nextCalled, false)
})

test('auth middleware accepts a valid token when its session version matches', async () => {
  const token = generateToken({
    userId: 'user-1',
    email: 'person@example.com',
    tokenVersion: 2,
  })
  const result = await invokeMiddleware(`Bearer ${token}`, 2)
  assert.equal(result.nextCalled, true)
  assert.equal(result.user?.userId, 'user-1')
  assert.equal(result.nextError, undefined)
})
