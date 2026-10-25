import { Request, Response } from 'express'
import { ZodError } from 'zod'
import logger from '@/utils/logger'
import {
  AccountDeletionError,
  AccountEmailQueueError,
  ActiveSubscriptionError,
  AuthService,
  EmailAlreadyRegisteredError,
  EmailVerificationRequiredError,
  InvalidCredentialsError,
  UserNotFoundError,
} from './auth.service'
import {
  deleteAccountSchema,
  emailSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.validation'

function statusFor(error: unknown): number {
  if (error instanceof ZodError) return 400
  if (error instanceof InvalidCredentialsError) return 401
  if (error instanceof EmailAlreadyRegisteredError) return 409
  if (error instanceof ActiveSubscriptionError) return 409
  if (error instanceof AccountDeletionError) return 400
  if (error instanceof UserNotFoundError) return 404
  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  ) {
    return error.statusCode
  }
  return 500
}

export class AuthController {
  constructor(private readonly authService = new AuthService()) {}

  async register(req: Request, res: Response): Promise<void> {
    try {
      const input = registerSchema.parse(req.body)
      const result = await this.authService.register(input)
      res.status(201).json(result)
    } catch (error) {
      const status = statusFor(error)
      res.status(status).json({
        error: error instanceof EmailAlreadyRegisteredError
          ? 'Email already registered'
          : error instanceof AccountEmailQueueError
            ? 'Your account was created, but the verification code could not be queued. Please request a new code from sign in.'
          : status === 400
            ? 'Invalid registration request'
            : 'Registration is temporarily unavailable',
      })
    }
  }

  async login(req: Request, res: Response): Promise<void> {
    try {
      const input = loginSchema.parse(req.body)
      res.json(await this.authService.login(input))
    } catch (error) {
      const status = statusFor(error)
      res.status(status).json({
        error:
          error instanceof EmailVerificationRequiredError
            ? error.message
            : status === 401
              ? 'Invalid email or password'
              : status === 400
                ? 'Invalid login request'
                : 'Login is temporarily unavailable',
      })
    }
  }

  async requestEmailVerification(req: Request, res: Response): Promise<void> {
    let email: string
    try {
      email = emailSchema.parse(req.body).email
    } catch {
      res.status(400).json({ error: 'Enter a valid email address.' })
      return
    }

    try {
      await this.authService.requestEmailVerification(email)
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Email verification request could not be queued'
      )
    }
    res.json({
      message: 'If this address is eligible for verification, follow the instructions provided by email. This response does not confirm account status or email delivery.',
    })
  }

  async getCurrentUser(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    try {
      res.json({ user: await this.authService.getCurrentUser(req.user.userId) })
    } catch (error) {
      const status = statusFor(error)
      res.status(status).json({
        error: status === 404 ? 'User not found' : 'Unable to load account',
      })
    }
  }

  async logout(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    try {
      await this.authService.logout(req.user.userId)
      res.json({ message: 'Logged out successfully. Existing sessions have been revoked.' })
    } catch {
      res.status(500).json({ error: 'Unable to revoke sessions' })
    }
  }

  async resendVerificationEmail(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    try {
      await this.authService.resendVerificationEmail(req.user.userId)
      res.json({ message: 'If verification is needed, a code will be queued for delivery.' })
    } catch {
      res.status(503).json({ error: 'Unable to process the verification request' })
    }
  }

  async verifyEmail(req: Request, res: Response): Promise<void> {
    try {
      const { email, otp } = verifyEmailSchema.parse(req.body)
      const result = await this.authService.verifyEmail(email, otp)
      if (result.status !== 'verified') {
        const responses = {
          invalid: { status: 400, error: 'The verification code is invalid or has already been used.' },
          expired: { status: 410, error: 'The verification code has expired. Request a new code.' },
          'attempts-exceeded': { status: 429, error: 'Too many incorrect codes. Request a new code.' },
          'already-verified': { status: 409, error: 'This email address is already verified. Please sign in.' },
        } as const
        const response = responses[result.status]
        res.status(response.status).json({ error: response.error })
        return
      }
      res.json({ verified: true, message: 'Email verified successfully. Please sign in to continue.' })
    } catch (error) {
      const status = statusFor(error)
      res.status(status).json({
        error: status === 400 ? 'Enter a valid email address and six-digit code.' : 'Unable to process the verification request',
      })
    }
  }

  async requestPasswordReset(req: Request, res: Response): Promise<void> {
    let email: string
    try {
      email = emailSchema.parse(req.body).email
    } catch {
      res.status(400).json({ error: 'Unable to process the password reset request' })
      return
    }
    try {
      await this.authService.requestPasswordReset(email)
    } catch {
      logger.error('Password reset request could not be processed')
      res.json({ message: 'If an account exists for that email, reset instructions will be sent.' })
      return
    }
    res.json({ message: 'If an account exists for that email, reset instructions will be sent.' })
  }

  async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const { token, password } = resetPasswordSchema.parse(req.body)
      const reset = await this.authService.resetPassword(token, password)
      res.status(reset ? 200 : 400).json({
        message: reset ? 'Password reset successfully. Sign in again.' : 'Invalid or expired reset link.',
      })
    } catch (error) {
      res.status(statusFor(error)).json({ error: 'Unable to reset password' })
    }
  }

  async deleteAccount(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    try {
      const input = deleteAccountSchema.parse(req.body)
      const result = await this.authService.deleteAccount(
        req.user.userId,
        input.password,
        input.confirmation
      )
      res.json({
        message: 'Account deleted. Locally stored account data and provider credentials were removed.',
        providerRevoked: result.providerRevoked,
      })
    } catch (error) {
      const status = statusFor(error)
      res.status(status).json({
        error:
          error instanceof ActiveSubscriptionError
            ? error.message
            : status === 400
              ? 'Account confirmation or credentials are invalid'
              : 'Unable to delete account',
      })
    }
  }
}
