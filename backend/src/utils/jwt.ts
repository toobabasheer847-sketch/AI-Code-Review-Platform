import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'
import { env } from '@/config/env'

interface JWTPayload {
  userId: string
  email: string
  tokenVersion?: number
}

export function generateToken(payload: JWTPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRY as SignOptions['expiresIn'],
    algorithm: 'HS256',
  }

  return jwt.sign(payload, env.JWT_SECRET, options)
}

export function verifyToken(token: string): JWTPayload {
  const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] })
  if (
    typeof payload === 'string' ||
    typeof payload.userId !== 'string' ||
    typeof payload.email !== 'string' ||
    !Number.isSafeInteger(payload.exp) ||
    (payload.exp as number) <= Math.floor(Date.now() / 1000) ||
    (payload.tokenVersion !== undefined &&
      (!Number.isSafeInteger(payload.tokenVersion) || payload.tokenVersion < 0))
  ) {
    throw new Error('Invalid authentication token')
  }
  return {
    userId: payload.userId,
    email: payload.email,
    ...(typeof payload.tokenVersion === 'number' ? { tokenVersion: payload.tokenVersion } : {}),
  }
}
