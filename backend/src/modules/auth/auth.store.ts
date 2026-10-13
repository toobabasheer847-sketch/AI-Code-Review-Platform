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
  consumeEmailVerification(tokenHash: string, now: Date): Promise<boolean>
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

  async consumeEmailVerification(tokenHash, now) {
    return prisma.$transaction(async (transaction) => {
      const token = await transaction.accountToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, type: true, expiresAt: true },
      })
      if (!token || token.type !== 'EMAIL_VERIFICATION' || token.expiresAt <= now) return false
      const consumed = await transaction.accountToken.deleteMany({
        where: { id: token.id, type: 'EMAIL_VERIFICATION', expiresAt: { gt: now } },
      })
      if (consumed.count !== 1) return false
      await transaction.user.update({
        where: { id: token.userId },
        data: { isVerified: true },
      })
      return true
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
