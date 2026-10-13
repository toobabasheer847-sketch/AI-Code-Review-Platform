import { createHash, randomBytes } from 'node:crypto'
import { env } from '@/config/env'
import { emailQueue } from '@/jobs/email.queue'
import { hashPassword, comparePassword } from '@/utils/bcrypt'
import { generateToken as generateJWT } from '@/utils/jwt'
import logger from '@/utils/logger'
import type { AccountEmailJob } from '@/modules/email/account-email.types'
import { GitHubService } from '@/modules/github/github.service'
import type { LoginInput, RegisterInput } from './auth.validation'
import type { AuthResponse, UserResponse } from './auth.types'
import { ActiveSubscriptionError, authStore, type AuthStore } from './auth.store'

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000

interface AuthEmailQueue {
  add(
    name: string,
    data: AccountEmailJob,
    options: { jobId: string; attempts: number; removeOnComplete: boolean }
  ): Promise<unknown>
}

interface GitHubAccountLifecycle {
  disconnectAccount(userId: string): Promise<{ providerRevoked: boolean }>
}

interface AuthServiceDependencies {
  store?: AuthStore
  emailQueue?: AuthEmailQueue
  github?: GitHubAccountLifecycle
  now?: () => Date
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function createToken(): string {
  return randomBytes(32).toString('hex')
}

function accountActionUrl(path: string, token: string): string {
  const url = new URL(path, env.FRONTEND_URL)
  url.hash = new URLSearchParams({ token }).toString()
  return url.toString()
}

export class InvalidCredentialsError extends Error {
  readonly statusCode = 401

  constructor() {
    super('Invalid email or password')
    this.name = 'InvalidCredentialsError'
  }
}

export class EmailAlreadyRegisteredError extends Error {
  readonly statusCode = 409

  constructor() {
    super('Email already registered')
    this.name = 'EmailAlreadyRegisteredError'
  }
}

export class UserNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('User not found')
    this.name = 'UserNotFoundError'
  }
}

export class AccountDeletionError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Account could not be deleted')
    this.name = 'AccountDeletionError'
  }
}

export class AuthService {
  private readonly store: AuthStore
  private readonly mailQueue: AuthEmailQueue
  private readonly github: GitHubAccountLifecycle
  private readonly now: () => Date

  constructor(dependencies: AuthServiceDependencies = {}) {
    this.store = dependencies.store ?? authStore
    this.mailQueue = dependencies.emailQueue ?? emailQueue
    this.github = dependencies.github ?? new GitHubService()
    this.now = dependencies.now ?? (() => new Date())
  }

  private toUserResponse(user: {
    id: string
    email: string
    fullName: string
    avatar: string | null
    isVerified: boolean
    createdAt: Date
    updatedAt: Date
    githubAccount?: { username: string } | null
  }): UserResponse {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatar: user.avatar,
      isVerified: user.isVerified,
      githubConnected: !!user.githubAccount,
      githubUsername: user.githubAccount?.username ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  }

  private async queueAccountEmail(
    userId: string,
    email: string,
    type: AccountEmailJob['type'],
    path: string,
    token: string
  ): Promise<void> {
    try {
      await this.mailQueue.add(
        type,
        { type, payload: { to: email, url: accountActionUrl(path, token) } },
        {
          jobId: `${type}-${userId}-${hashToken(token).slice(0, 16)}`,
          attempts: 3,
          removeOnComplete: true,
        }
      )
    } catch {
      logger.error({ userId, emailType: type }, 'Account email could not be queued')
    }
  }

  private async issueEmailVerification(
    userId: string,
    email: string
  ): Promise<void> {
    const token = createToken()
    await this.store.replaceToken(
      userId,
      'EMAIL_VERIFICATION',
      hashToken(token),
      new Date(this.now().getTime() + EMAIL_VERIFICATION_TTL_MS)
    )
    await this.queueAccountEmail(userId, email, 'auth:verify-email', '/verify-email', token)
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await this.store.findUserByEmail(input.email)
    if (!user || !(await comparePassword(input.password, user.passwordHash))) {
      throw new InvalidCredentialsError()
    }
    return {
      token: generateJWT({
        userId: user.id,
        email: user.email,
        tokenVersion: user.tokenVersion,
      }),
      user: this.toUserResponse(user),
    }
  }

  async register(input: RegisterInput): Promise<AuthResponse> {
    const existingUser = await this.store.findUserByEmail(input.email)
    if (existingUser) throw new EmailAlreadyRegisteredError()

    const user = await this.store.createUser({
      email: input.email,
      fullName: input.fullName,
      passwordHash: await hashPassword(input.password),
    })
    await this.issueEmailVerification(user.id, user.email)

    return {
      token: generateJWT({ userId: user.id, email: user.email, tokenVersion: user.tokenVersion }),
      user: this.toUserResponse(user),
    }
  }

  async getCurrentUser(userId: string): Promise<UserResponse> {
    const user = await this.store.findUserById(userId)
    if (!user) throw new UserNotFoundError()
    return this.toUserResponse(user)
  }

  async resendVerificationEmail(userId: string): Promise<void> {
    const user = await this.store.findUserById(userId)
    if (user && !user.isVerified) await this.issueEmailVerification(user.id, user.email)
  }

  async verifyEmail(token: string): Promise<boolean> {
    return this.store.consumeEmailVerification(hashToken(token), this.now())
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.store.findUserByEmail(email)
    if (!user) return

    const token = createToken()
    await this.store.replaceToken(
      user.id,
      'PASSWORD_RESET',
      hashToken(token),
      new Date(this.now().getTime() + PASSWORD_RESET_TTL_MS)
    )
    await this.queueAccountEmail(
      user.id,
      user.email,
      'auth:password-reset',
      '/reset-password',
      token
    )
  }

  async resetPassword(token: string, password: string): Promise<boolean> {
    return this.store.consumePasswordReset(
      hashToken(token),
      await hashPassword(password),
      this.now()
    )
  }

  async logout(userId: string): Promise<void> {
    await this.store.invalidateSessions(userId)
  }

  async deleteAccount(
    userId: string,
    password: string,
    confirmation: 'DELETE'
  ): Promise<{ providerRevoked: boolean }> {
    if (confirmation !== 'DELETE') throw new AccountDeletionError()
    const user = await this.store.findUserById(userId)
    if (!user || !(await comparePassword(password, user.passwordHash))) {
      throw new AccountDeletionError()
    }
    if (await this.store.hasActiveSubscription(userId)) {
      throw new ActiveSubscriptionError()
    }

    const disconnect = await this.github.disconnectAccount(userId)
    await this.store.deleteUser(userId)
    return disconnect
  }
}

export { ActiveSubscriptionError }
