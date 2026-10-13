import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import jwt from 'jsonwebtoken'
import { comparePassword, hashPassword } from '@/utils/bcrypt'
import { env } from '@/config/env'
import { isTokenVersionCurrent } from '@/middleware/auth.middleware'
import { verifyToken } from '@/utils/jwt'
import type { AuthStore, StoredAuthUser, AuthTokenType } from './auth.store'
import { ActiveSubscriptionError, AuthService } from './auth.service'

const now = new Date('2026-10-13T12:00:00Z')

function createStore(): AuthStore & {
  user: StoredAuthUser
  token?: { hash: string; type: AuthTokenType; expiresAt: Date }
  activeSubscription: boolean
  consumed: boolean
} {
  const createdAt = new Date('2026-01-01T00:00:00Z')
  const store = {
    user: {
      id: 'user-1',
      email: 'person@example.com',
      fullName: 'Test Person',
      avatar: null,
      passwordHash: '',
      isVerified: false,
      tokenVersion: 0,
      createdAt,
      updatedAt: createdAt,
      githubAccount: null,
    } as StoredAuthUser,
    activeSubscription: false,
    consumed: false,
    async findUserByEmail(email: string) {
      return email === store.user.email ? store.user : null
    },
    async findUserById(userId: string) {
      return userId === store.user.id ? store.user : null
    },
    async createUser(data: { email: string; fullName: string; passwordHash: string }) {
      store.user = { ...store.user, ...data }
      return store.user
    },
    async replaceToken(
      _userId: string,
      type: AuthTokenType,
      tokenHash: string,
      expiresAt: Date
    ) {
      store.token = { hash: tokenHash, type, expiresAt }
      store.consumed = false
    },
    async consumeEmailVerification(tokenHash: string, at: Date) {
      if (
        store.consumed ||
        store.token?.hash !== tokenHash ||
        store.token.type !== 'EMAIL_VERIFICATION' ||
        store.token.expiresAt <= at
      ) {
        return false
      }
      store.consumed = true
      store.user.isVerified = true
      return true
    },
    async consumePasswordReset(tokenHash: string, passwordHash: string, at: Date) {
      if (
        store.consumed ||
        store.token?.hash !== tokenHash ||
        store.token.type !== 'PASSWORD_RESET' ||
        store.token.expiresAt <= at
      ) {
        return false
      }
      store.consumed = true
      store.user.passwordHash = passwordHash
      store.user.tokenVersion += 1
      return true
    },
    async invalidateSessions() {
      store.user.tokenVersion += 1
    },
    async hasActiveSubscription() {
      return store.activeSubscription
    },
    async deleteUser() {
      store.user.id = ''
    },
  }
  return store
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

test('registration stores only a verification-token hash and emails a short-lived link', async () => {
  const store = createStore()
  store.findUserByEmail = async () => null
  let emailJob: unknown
  const service = new AuthService({
    store,
    now: () => now,
    emailQueue: {
      async add(_name, data) {
        emailJob = data
      },
    },
    github: { async disconnectAccount() { return { providerRevoked: false } } },
  })
  const result = await service.register({
    email: 'person@example.com',
    fullName: 'Test Person',
    password: 'secure-pass-123',
  })
  const token = new URLSearchParams(
    new URL((emailJob as { payload: { url: string } }).payload.url).hash.slice(1)
  ).get('token')

  assert.ok(token)
  assert.equal(store.token?.hash, tokenHash(token))
  assert.equal(store.token?.expiresAt.getTime(), now.getTime() + 24 * 60 * 60 * 1000)
  assert.equal(JSON.stringify(store.user).includes(token), false)
  assert.equal(result.user.isVerified, false)
  assert.equal(jwt.decode(result.token)?.tokenVersion, 0)
})

test('email verification tokens are single-use and expire', async () => {
  const store = createStore()
  store.findUserByEmail = async () => null
  let emailJob: unknown
  const service = new AuthService({
    store,
    now: () => now,
    emailQueue: {
      async add(_name, data) {
        emailJob = data
      },
    },
  })
  await service.register({
    email: 'person@example.com',
    fullName: 'Test Person',
    password: 'secure-pass-123',
  })
  const token = new URLSearchParams(
    new URL((emailJob as { payload: { url: string } }).payload.url).hash.slice(1)
  ).get('token')!

  assert.equal(await service.verifyEmail(token), true)
  assert.equal(await service.verifyEmail(token), false)
  assert.equal(store.user.isVerified, true)

  await store.replaceToken(
    store.user.id,
    'EMAIL_VERIFICATION',
    tokenHash(token),
    new Date(now.getTime() - 1)
  )
  assert.equal(await service.verifyEmail(token), false)
})

test('password reset is generic for unknown email and revokes existing JWTs', async () => {
  const store = createStore()
  store.user.passwordHash = await hashPassword('initial-secure-pass-123')
  let emailJob: unknown
  const service = new AuthService({
    store,
    now: () => now,
    emailQueue: {
      async add(_name, data) {
        emailJob = data
      },
    },
  })
  await service.requestPasswordReset('missing@example.com')
  assert.equal(emailJob, undefined)
  await service.requestPasswordReset(store.user.email)
  const token = new URLSearchParams(
    new URL((emailJob as { payload: { url: string } }).payload.url).hash.slice(1)
  ).get('token')!
  const priorToken = jwt.sign(
    { userId: store.user.id, email: store.user.email, tokenVersion: 0 },
    env.JWT_SECRET,
    { expiresIn: '1h', algorithm: 'HS256' }
  )

  assert.equal(await service.resetPassword(token, 'new-secure-pass-123'), true)
  assert.equal(await service.resetPassword(token, 'another-secure-pass-123'), false)
  assert.equal(store.user.tokenVersion, 1)
  assert.equal(
    await comparePassword('initial-secure-pass-123', store.user.passwordHash),
    false
  )
  assert.doesNotThrow(() => jwt.verify(priorToken, env.JWT_SECRET))
  assert.equal(isTokenVersionCurrent({ userId: store.user.id, email: store.user.email, tokenVersion: 0 }, 1), false)
  assert.equal(isTokenVersionCurrent({ userId: store.user.id, email: store.user.email }, 1), false)
})

test('logout revokes sessions and account deletion checks password and subscription status', async () => {
  const store = createStore()
  const service = new AuthService({
    store,
    github: { async disconnectAccount() { return { providerRevoked: true } } },
  })
  store.user.passwordHash = await hashPassword('correct-pass-1')

  await service.logout(store.user.id)
  assert.equal(store.user.tokenVersion, 1)
  await assert.rejects(
    service.deleteAccount(store.user.id, 'wrong-password', 'DELETE'),
    /Account could not be deleted/
  )

  store.activeSubscription = true
  await assert.rejects(
    service.deleteAccount(store.user.id, 'correct-pass-1', 'DELETE'),
    ActiveSubscriptionError
  )
  assert.equal(store.user.id, 'user-1')

  store.activeSubscription = false
  const result = await service.deleteAccount(store.user.id, 'correct-pass-1', 'DELETE')
  assert.deepEqual(result, { providerRevoked: true })
  assert.equal(store.user.id, '')
})

test('JWT verification rejects invalid and expired credentials and revocation versions', () => {
  const expired = jwt.sign(
    { userId: 'user-1', email: 'person@example.com', tokenVersion: 0 },
    env.JWT_SECRET,
    { expiresIn: -1, algorithm: 'HS256' }
  )
  assert.throws(() => verifyToken('not-a-jwt'))
  assert.throws(() => verifyToken(expired))
  assert.equal(
    isTokenVersionCurrent(
      { userId: 'user-1', email: 'person@example.com', tokenVersion: 1 },
      1
    ),
    true
  )
  assert.equal(
    isTokenVersionCurrent({ userId: 'user-1', email: 'person@example.com' }, 1),
    false
  )
})

test('account deletion rejects another user identity from the request', async () => {
  const store = createStore()
  const service = new AuthService({
    store,
    github: { async disconnectAccount() { return { providerRevoked: false } } },
  })
  await assert.rejects(
    service.deleteAccount('user-2', 'any-password', 'DELETE'),
    /Account could not be deleted/
  )
})
