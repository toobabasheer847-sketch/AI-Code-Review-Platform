import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { CookieOptions, Request, Response } from 'express'
import { env } from '@/config/env'

export const CSRF_TOKEN_TTL_MS = 2 * 60 * 60 * 1000

const COOKIE_PATH = '/'

function jwtExpiryMilliseconds(expiry: string): number {
  const match = /^([1-9]\d*)([smhdw])$/.exec(expiry)
  if (!match) throw new Error('JWT_EXPIRY must be a positive duration such as 15m or 7d')
  const amount = Number(match[1])
  const unitMilliseconds: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  }
  const duration = amount * unitMilliseconds[match[2]]
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new Error('JWT_EXPIRY must be a positive duration such as 15m or 7d')
  }
  return duration
}

function cookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.AUTH_COOKIE_SAME_SITE,
    path: COOKIE_PATH,
    maxAge,
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(env.AUTH_SESSION_COOKIE_NAME, token, cookieOptions(jwtExpiryMilliseconds(env.JWT_EXPIRY)))
}

export function clearSessionCookies(res: Response): void {
  const options = cookieOptions(0)
  delete options.maxAge
  res.clearCookie(env.AUTH_SESSION_COOKIE_NAME, options)
}

export function readCookie(req: Request, name: string): string | null {
  const values = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
  if (values.length !== 1) return null
  try {
    return decodeURIComponent(values[0].slice(name.length + 1))
  } catch {
    return null
  }
}

function csrfSignature(random: string, issuedAt: number): string {
  return createHmac('sha256', env.CSRF_SECRET)
    .update(`ai-codeguard-csrf:v1:${random}:${issuedAt}`)
    .digest('base64url')
}

export function createCsrfToken(now = Date.now()): string {
  const random = randomBytes(32).toString('hex')
  const issuedAt = Math.floor(now / 1_000)
  return `${random}.${issuedAt}.${csrfSignature(random, issuedAt)}`
}

export function isValidCsrfToken(token: string, now = Date.now()): boolean {
  const match = /^([a-f0-9]{64})\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(token)
  if (!match) return false

  const issuedAt = Number(match[2]) * 1_000
  if (issuedAt > now + 30_000 || now - issuedAt > CSRF_TOKEN_TTL_MS) return false

  const expected = Buffer.from(csrfSignature(match[1], Number(match[2])))
  const actual = Buffer.from(match[3])
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
