import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { Prisma } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { comparePassword, hashPassword } from '@/utils/bcrypt'
import { env } from '@/config/env'
import { isTokenVersionCurrent } from '@/middleware/auth.middleware'
import { verifyToken } from '@/utils/jwt'
import { decryptVerificationOtp } from '@/modules/email/verification-otp.crypto'
import { isRedisVersionSupported } from '@/jobs/email.queue'
import {
  getSafeMailErrorDetails,
  MailConfigurationError,
  validateMailConfiguration,
} from '@/modules/email/mail.service'
import type { AuthStore, StoredAuthUser, AuthTokenType } from './auth.store'
import {
  AccountEmailQueueError,
  ActiveSubscriptionError,
  AuthService,
  EmailVerificationRequiredError,
} from './auth.service'

const now = new Date('2026-10-13T12:00:00Z')

test('BullMQ Redis version diagnostics reject versions below 6.2', () => {
  assert.equal(isRedisVersionSupported('5.0.14.1'), false)
  assert.equal(isRedisVersionSupported('6.1.9'), false)
  assert.equal(isRedisVersionSupported('6.2.0'), true)
  assert.equal(isRedisVersionSupported('7.2.4'), true)
  assert.equal(isRedisVersionSupported('unknown'), false)
})

test('mail configuration diagnostics identify missing fields without exposing values', () => {
  const credential = 'private-mail-password'
  assert.throws(
    () =>
      validateMailConfiguration({
        MAIL_HOST: 'smtp.example.test',
        MAIL_PORT: 587,
        MAIL_USER: '',
        MAIL_PASSWORD: credential,
        MAIL_FROM: 'noreply@example.test',
      }),
    (error: unknown) => {
      assert.ok(error instanceof MailConfigurationError)
      assert.match(error.message, /MAIL_USER/)
      assert.equal(error.message.includes(credential), false)
      return true
    }
  )
})

test('SMTP failure diagnostics retain error codes but omit sensitive messages', () => {
  const error = Object.assign(new Error('SMTP authentication failed for private-mail-password'), {
    code: 'EAUTH',
    command: 'AUTH LOGIN',
    responseCode: 535,
  })
  const details = getSafeMailErrorDetails(error)

  assert.deepEqual(details, {
    errorType: 'Error',
    errorCode: 'EAUTH',
    command: 'AUTH LOGIN',
    responseCode: 535,
  })
  assert.equal(JSON.stringify(details).includes('private-mail-password'), false)
})

function createStore(): AuthStore & {
  user: StoredAuthUser
  token?: {
    hash: string
    type: AuthTokenType
    expiresAt: Date
    createdAt: Date
    attemptCount: number
  }
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
      store.token = {
        hash: tokenHash,
        type,
        expiresAt,
        createdAt: now,
        attemptCount: 0,
      }
      store.consumed = false
    },
    async issueEmailVerificationOtp(
      _userId: string,
      tokenHash: string,
      expiresAt: Date,
      at: Date,
      cooldownMs: number
    ) {
      if (
        store.token?.type === 'EMAIL_VERIFICATION' &&
        store.token.createdAt.getTime() + cooldownMs > at.getTime()
      ) {
        return false
      }
      store.token = {
        hash: tokenHash,
        type: 'EMAIL_VERIFICATION',
        expiresAt,
        createdAt: at,
        attemptCount: 0,
      }
      store.consumed = false
      return true
    },
    async deleteEmailVerificationOtp(_userId: string, tokenHash: string) {
      if (store.token?.hash === tokenHash) store.token = undefined
    },
    async consumeEmailVerificationOtp(
      _userId: string,
      tokenHash: string,
      at: Date,
      maxAttempts: number
    ) {
      const token = store.token
      if (store.consumed || !token || token.type !== 'EMAIL_VERIFICATION') {
        return { status: 'invalid' as const }
      }
      if (token.expiresAt <= at) return { status: 'expired' as const }
      if (token.attemptCount >= maxAttempts) return { status: 'attempts-exceeded' as const }
      if (token.hash !== tokenHash) {
        token.attemptCount += 1
        return {
          status: token.attemptCount >= maxAttempts
            ? 'attempts-exceeded' as const
            : 'invalid' as const,
        }
      }
      store.consumed = true
      store.user.isVerified = true
      return { status: 'verified' as const, user: store.user }
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

test('registration stores an HMAC hash and queues an encrypted six-digit OTP without a session', async () => {
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
  const encryptedPayload = (emailJob as {
    payload: { to: string; otp: { ciphertext: string; iv: string; tag: string } }
  }).payload
  const otp = decryptVerificationOtp(encryptedPayload.otp)
  const expectedHash = createHmac('sha256', env.EMAIL_OTP_SECRET)
    .update(`email-verification:${store.user.id}:${otp}`)
    .digest('hex')

  assert.match(otp, /^\d{6}$/)
  assert.equal(encryptedPayload.to, store.user.email)
  assert.equal(store.token?.hash, expectedHash)
  assert.equal(store.token?.expiresAt.getTime(), now.getTime() + 10 * 60 * 1000)
  assert.equal(JSON.stringify(emailJob).includes(otp), false)
  assert.equal('token' in result, false)
  assert.equal(result.verificationRequired, true)
  assert.equal(store.user.isVerified, false)
})

test('registration reports queue failure and does not issue a session or retain an unusable OTP', async () => {
  const store = createStore()
  store.findUserByEmail = async () => null
  const service = new AuthService({
    store,
    now: () => now,
    emailQueue: {
      async add() {
        throw new Error('queue unavailable')
      },
    },
    github: { async disconnectAccount() { return { providerRevoked: false } } },
  })

  await assert.rejects(
    service.register({
      email: 'person@example.com',
      fullName: 'Test Person',
      password: 'secure-pass-123',
    }),
    AccountEmailQueueError
  )
  assert.equal(store.token, undefined)
  assert.equal(store.user.isVerified, false)
})

test('verification accepts a valid OTP once and reports expired OTPs', async () => {
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
  store.findUserByEmail = async (email) => email === store.user.email ? store.user : null
  const otp = decryptVerificationOtp(
    (emailJob as { payload: { otp: { ciphertext: string; iv: string; tag: string } } }).payload.otp
  )
  assert.equal(
    store.token?.hash,
    createHmac('sha256', env.EMAIL_OTP_SECRET)
      .update(`email-verification:${store.user.id}:${otp}`)
      .digest('hex')
  )
  const verification = await service.verifyEmail(store.user.email, otp)
  assert.equal(verification.status, 'verified')
  assert.equal(store.user.isVerified, true)
  assert.equal((await service.verifyEmail(store.user.email, otp)).status, 'already-verified')
  assert.equal(store.user.isVerified, true)

  store.user.isVerified = false
  store.consumed = false
  store.token!.expiresAt = new Date(now.getTime() - 1)
  assert.equal((await service.verifyEmail(store.user.email, otp)).status, 'expired')
})

test('duplicate registration is rejected without creating a second user', async () => {
  const store = createStore()
  let createCount = 0
  store.createUser = async (data) => {
    createCount += 1
    store.user = { ...store.user, ...data }
    return store.user
  }
  const service = new AuthService({ store })

  await assert.rejects(
    service.register({
      email: store.user.email,
      fullName: 'Test Person',
      password: 'secure-pass-123',
    }),
    /Email already registered/
  )
  assert.equal(createCount, 0)
})

test('concurrent duplicate registration maps the database unique constraint to conflict', async () => {
  const store = createStore()
  store.findUserByEmail = async () => null
  store.createUser = async () => {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['email'] },
    })
  }
  const service = new AuthService({ store })

  await assert.rejects(
    service.register({
      email: 'person@example.com',
      fullName: 'Test Person',
      password: 'secure-pass-123',
    }),
    /Email already registered/
  )
})

test('invalid OTP attempts are capped and a resend invalidates the previous OTP', async () => {
  const store = createStore()
  store.findUserByEmail = async () => null
  let currentNow = new Date(now)
  const jobs: unknown[] = []
  const service = new AuthService({
    store,
    now: () => currentNow,
    emailQueue: {
      async add(_name, data) {
        jobs.push(data)
      },
    },
  })
  await service.register({
    email: 'person@example.com',
    fullName: 'Test Person',
    password: 'secure-pass-123',
  })
  store.findUserByEmail = async (email) => email === store.user.email ? store.user : null
  const originalOtp = decryptVerificationOtp(
    (jobs[0] as { payload: { otp: { ciphertext: string; iv: string; tag: string } } }).payload.otp
  )
  const wrongOtp = originalOtp === '000000' ? '000001' : '000000'
  for (let attempt = 1; attempt < 5; attempt += 1) {
    assert.equal((await service.verifyEmail(store.user.email, wrongOtp)).status, 'invalid')
  }
  assert.equal((await service.verifyEmail(store.user.email, wrongOtp)).status, 'attempts-exceeded')

  currentNow = new Date(now.getTime() + 60_000)
  await service.requestEmailVerification(store.user.email)
  assert.equal(jobs.length, 2)
  const replacementOtp = decryptVerificationOtp(
    (jobs[1] as { payload: { otp: { ciphertext: string; iv: string; tag: string } } }).payload.otp
  )
  assert.equal((await service.verifyEmail(store.user.email, originalOtp)).status, 'invalid')
  assert.equal((await service.verifyEmail(store.user.email, replacementOtp)).status, 'verified')
})

test('resend cooldown prevents issuing another OTP before 60 seconds', async () => {
  const store = createStore()
  store.findUserByEmail = async () => null
  let jobCount = 0
  const service = new AuthService({
    store,
    now: () => now,
    emailQueue: {
      async add() {
        jobCount += 1
      },
    },
  })
  await service.register({
    email: 'person@example.com',
    fullName: 'Test Person',
    password: 'secure-pass-123',
  })
  await service.requestEmailVerification(store.user.email)
  assert.equal(jobCount, 1)
})

test('concurrent verification requests consume an OTP only once', async () => {
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
  store.findUserByEmail = async (email) => email === store.user.email ? store.user : null
  const otp = decryptVerificationOtp(
    (emailJob as { payload: { otp: { ciphertext: string; iv: string; tag: string } } }).payload.otp
  )

  const results = await Promise.all([
    service.verifyEmail(store.user.email, otp),
    service.verifyEmail(store.user.email, otp),
  ])
  assert.equal(results.filter((result) => result.status === 'verified').length, 1)
  assert.equal(store.user.isVerified, true)
})

test('unverified users cannot log in and can request a replacement verification email', async () => {
  const store = createStore()
  store.user.passwordHash = await hashPassword('secure-pass-123')
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

  await assert.rejects(
    service.login({ email: store.user.email, password: 'secure-pass-123' }),
    EmailVerificationRequiredError
  )
  await service.requestEmailVerification(store.user.email)
  assert.equal((emailJob as { type: string }).type, 'auth:verify-email')

  const otp = decryptVerificationOtp(
    (emailJob as { payload: { otp: { ciphertext: string; iv: string; tag: string } } }).payload.otp
  )
  assert.equal((await service.verifyEmail(store.user.email, otp)).status, 'verified')
  assert.equal((await service.login({ email: store.user.email, password: 'secure-pass-123' })).user.isVerified, true)
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
