import type { NextFunction, Request, Response } from 'express'
import { env } from '@/config/env'
import { isValidCsrfToken } from '@/modules/auth/auth-session'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const SIGNED_WEBHOOK_PATHS = new Set([
  '/billing/webhook',
  '/webhooks/github',
  '/reviews/internal/verification-callback',
])
const trustedOrigin = new URL(env.FRONTEND_URL).origin

export function apiSecurityMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (SAFE_METHODS.has(req.method.toUpperCase()) || SIGNED_WEBHOOK_PATHS.has(req.path)) {
    next()
    return
  }

  if (req.get('origin') !== trustedOrigin) {
    res.status(403).json({ error: 'Request origin is not allowed', code: 'ORIGIN_INVALID' })
    return
  }

  const headerToken = req.get('x-csrf-token')
  if (!headerToken || !isValidCsrfToken(headerToken)) {
    res.status(403).json({ error: 'CSRF validation failed', code: 'CSRF_INVALID' })
    return
  }

  next()
}
