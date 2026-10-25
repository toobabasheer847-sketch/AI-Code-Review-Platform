import { prisma } from '@/config/database'

export type StoredAuthUser = {
  id: string
  email: string
  fullName: string
  avatar: string | null
  passwordHash: string
  isVerified: boolean
  tokenVersion: number
  createdAt: Date
  updatedAt: Date
  githubAccount?: { username: string } | null
}

export type AuthTokenType = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'

export type EmailVerificationConsumption =
  | { status: 'verified'; user: StoredAuthUser }
  | { status: 'invalid' | 'expired' | 'attempts-exceeded' | 'already-verified' }

export interface AuthStore {
  findUserByEmail(email: string): Promise<StoredAuthUser | null>
  findUserById(userId: string): Promise<StoredAuthUser | null>
  createUser(data: { email: string; fullName: string; passwordHash: string }): Promise<StoredAuthUser>
  replaceToken(
    userId: string,
    type: AuthTokenType,
    tokenHash: string,
    expiresAt: Date
  ): Promise<void>
  issueEmailVerificationOtp(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    now: Date,
    cooldownMs: number
  ): Promise<boolean>
  deleteEmailVerificationOtp(userId: string, tokenHash: string): Promise<void>
  consumeEmailVerificationOtp(
    userId: string,
    tokenHash: string,
    now: Date,
    maxAttempts: number
  ): Promise<EmailVerificationConsumption>
  consumePasswordReset(
    tokenHash: string,
    passwordHash: string,
    now: Date
  ): Promise<boolean>
  invalidateSessions(userId: string): Promise<void>
  hasActiveSubscription(userId: string): Promise<boolean>
  deleteUser(userId: string): Promise<void>
}

export const authStore: AuthStore = {
  async findUserByEmail(email) {
    return prisma.user.findUnique({
      where: { email },
      include: { githubAccount: { select: { username: true } } },
    })
  },

  async findUserById(userId) {
    return prisma.user.findUnique({
      where: { id: userId },
      include: { githubAccount: { select: { username: true } } },
    })
  },

  async createUser(data) {
    return prisma.user.create({
      data,
      include: { githubAccount: { select: { username: true } } },
    })
  },

  async replaceToken(userId, type, tokenHash, expiresAt) {
    await prisma.$transaction(async (transaction) => {
      await transaction.accountToken.deleteMany({ where: { userId, type } })
      await transaction.accountToken.create({
        data: { userId, type, tokenHash, expiresAt },
      })
    })
  },

  async issueEmailVerificationOtp(userId, tokenHash, expiresAt, now, cooldownMs) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
      `
      const existing = await transaction.accountToken.findFirst({
        where: { userId, type: 'EMAIL_VERIFICATION' },
        select: { id: true, createdAt: true },
      })
      if (existing && existing.createdAt.getTime() + cooldownMs > now.getTime()) return false

      await transaction.accountToken.deleteMany({
        where: { userId, type: 'EMAIL_VERIFICATION' },
      })
      await transaction.accountToken.create({
        data: {
          userId,
          tokenHash,
          type: 'EMAIL_VERIFICATION',
          expiresAt,
          attemptCount: 0,
          createdAt: now,
        },
      })
      return true
    })
  },

  async deleteEmailVerificationOtp(userId, tokenHash) {
    await prisma.accountToken.deleteMany({
      where: { userId, tokenHash, type: 'EMAIL_VERIFICATION' },
    })
  },

  async consumeEmailVerificationOtp(userId, tokenHash, now, maxAttempts) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "AccountToken"
        WHERE "userId" = ${userId} AND "type" = 'EMAIL_VERIFICATION'::"AccountTokenType"
        FOR UPDATE
      `
      const token = await transaction.accountToken.findFirst({
        where: { userId, type: 'EMAIL_VERIFICATION' },
      })
      if (!token) return { status: 'invalid' as const }
      if (token.expiresAt <= now) {
        await transaction.accountToken.delete({ where: { id: token.id } })
        return { status: 'expired' as const }
      }
      if (token.attemptCount >= maxAttempts) return { status: 'attempts-exceeded' as const }
      if (token.tokenHash !== tokenHash) {
        const attemptCount = token.attemptCount + 1
        await transaction.accountToken.update({
          where: { id: token.id },
          data: { attemptCount },
        })
        return {
          status: attemptCount >= maxAttempts ? 'attempts-exceeded' as const : 'invalid' as const,
        }
      }

      const consumed = await transaction.accountToken.deleteMany({
        where: {
          id: token.id,
          type: 'EMAIL_VERIFICATION',
          expiresAt: { gt: now },
          attemptCount: { lt: maxAttempts },
        },
      })
      if (consumed.count !== 1) return { status: 'invalid' as const }

      const updated = await transaction.user.updateMany({
        where: { id: userId, isVerified: false },
        data: { isVerified: true },
      })
      if (updated.count !== 1) return { status: 'already-verified' as const }

      const user = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        include: { githubAccount: { select: { username: true } } },
      })
      return { status: 'verified' as const, user }
    })
  },

  async consumePasswordReset(tokenHash, passwordHash, now) {
    return prisma.$transaction(async (transaction) => {
      const token = await transaction.accountToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, type: true, expiresAt: true },
      })
      if (!token || token.type !== 'PASSWORD_RESET' || token.expiresAt <= now) return false
      const consumed = await transaction.accountToken.deleteMany({
        where: { id: token.id, type: 'PASSWORD_RESET', expiresAt: { gt: now } },
      })
      if (consumed.count !== 1) return false
      await transaction.user.update({
        where: { id: token.userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      })
      await transaction.accountToken.deleteMany({ where: { userId: token.userId } })
      return true
    })
  },

  async invalidateSessions(userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    })
  },

  async hasActiveSubscription(userId) {
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
      select: { plan: true, status: true, currentPeriodEnd: true },
    })
    return Boolean(
      subscription?.plan === 'PRO' &&
        (subscription.status === 'ACTIVE' ||
          (subscription.status === 'CANCELED' &&
            subscription.currentPeriodEnd !== null &&
            subscription.currentPeriodEnd > new Date()))
    )
  },

  async deleteUser(userId) {
    await prisma.$transaction(async (transaction) => {
      const subscription = await transaction.subscription.findUnique({
        where: { userId },
        select: { plan: true, status: true, currentPeriodEnd: true },
      })
      if (
        subscription?.plan === 'PRO' &&
        (subscription.status === 'ACTIVE' ||
          (subscription.status === 'CANCELED' &&
            subscription.currentPeriodEnd !== null &&
            subscription.currentPeriodEnd > new Date()))
      ) {
        throw new ActiveSubscriptionError()
      }
      await transaction.user.delete({ where: { id: userId } })
    })
  },
}

export class ActiveSubscriptionError extends Error {
  readonly statusCode = 409

  constructor() {
    super('Cancel the active subscription before deleting the account')
    this.name = 'ActiveSubscriptionError'
  }
}
