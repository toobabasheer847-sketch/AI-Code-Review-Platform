import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'
import { env } from '@/config/env'

interface JWTPayload {
  userId: string
  email: string
}

export function generateToken(payload: JWTPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRY as SignOptions['expiresIn'],
  }

  return jwt.sign(payload, env.JWT_SECRET, options)
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, env.JWT_SECRET) as JWTPayload
}
