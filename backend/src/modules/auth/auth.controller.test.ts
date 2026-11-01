import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import test from 'node:test'
import { AuthController, type AuthControllerService } from './auth.controller'
import { env } from '@/config/env'

const user = {
  id: 'user-1',
  email: 'person@example.com',
  fullName: 'Test Person',
  avatar: null,
  isVerified: true,
  githubConnected: false,
  githubUsername: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

let logoutCalls = 0

const service: AuthControllerService = {
  async register() {
    return {
      email: user.email,
      verificationRequired: true,
      verificationEmailQueued: true,
      message: 'Queued',
    }
  },
  async login() {
    return { token: 'server-only-session-jwt', user }
  },
  async getCurrentUser() {
    return user
  },
  async logout() {
    logoutCalls += 1
  },
  async resendVerificationEmail() {},
  async requestEmailVerification() {},
  async verifyEmail() {
    return { status: 'invalid' }
  },
  async requestPasswordReset() {},
  async resetPassword() {
    return false
  },
  async deleteAccount() {
    return { providerRevoked: false }
  },
}

test('login sets an HttpOnly, production Secure session cookie and never returns the JWT', async (context) => {
  const app = express()
  app.use(express.json())
  const controller = new AuthController(service)
  app.post('/auth/login', (req, res) => controller.login(req, res))
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
  const previousNodeEnv = env.NODE_ENV
  env.NODE_ENV = 'production'
  let response: globalThis.Response
  try {
    response = await fetch(`http://127.0.0.1:${address.port}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'secure-password-123' }),
    })
  } finally {
    env.NODE_ENV = previousNodeEnv
  }
  const body = await response.json() as { user: { id: string }; token?: string }
  const sessionCookie = response.headers.get('set-cookie')

  assert.equal(response.status, 200)
  assert.equal(body.user.id, user.id)
  assert.equal(body.token, undefined)
  assert.equal(JSON.stringify(body).includes('server-only-session-jwt'), false)
  assert.ok(sessionCookie?.includes(`${env.AUTH_SESSION_COOKIE_NAME}=`))
  assert.match(sessionCookie ?? '', /HttpOnly/i)
  assert.match(sessionCookie ?? '', /Secure/i)
  assert.match(sessionCookie ?? '', /SameSite=Lax/i)
  assert.match(sessionCookie ?? '', /Path=\//i)
})

test('logout revokes sessions and expires the HttpOnly cookie', async (context) => {
  const app = express()
  const controller = new AuthController(service)
  app.use((req, _res, next) => {
    req.user = { userId: user.id, email: user.email, tokenVersion: 0 }
    next()
  })
  app.post('/auth/logout', (req, res) => controller.logout(req, res))
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
  const callsBefore = logoutCalls
  const response = await fetch(`http://127.0.0.1:${address.port}/auth/logout`, {
    method: 'POST',
  })
  const cookie = response.headers.get('set-cookie')

  assert.equal(response.status, 200)
  assert.equal(logoutCalls, callsBefore + 1)
  assert.ok(cookie?.includes(`${env.AUTH_SESSION_COOKIE_NAME}=`))
  assert.match(cookie ?? '', /Expires=Thu, 01 Jan 1970/i)
})

test('CSRF bootstrap returns a signed non-authentication token without caching credentials', async (context) => {
  const app = express()
  const controller = new AuthController(service)
  app.get('/auth/csrf', (req, res) => controller.getCsrfToken(req, res))
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
  const response = await fetch(`http://127.0.0.1:${address.port}/auth/csrf`)
  const body = await response.json() as { csrfToken: string; expiresInMs: number }

  assert.equal(response.status, 200)
  assert.ok(body.csrfToken)
  assert.equal(body.expiresInMs, 2 * 60 * 60 * 1000)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(body.csrfToken.includes('server-only-session-jwt'), false)
})
