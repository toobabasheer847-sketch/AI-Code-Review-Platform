import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '@/utils/jwt'
import type { JWTPayload } from '@/types'
import { prisma } from '@/config/database'
import { clearSessionCookies, readCookie } from '@/modules/auth/auth-session'
import { env } from '@/config/env'

export function isTokenVersionCurrent(
  payload: JWTPayload,
  currentVersion: number
): boolean {
  return payload.tokenVersion === undefined
    ? currentVersion === 0
    : payload.tokenVersion === currentVersion
}

interface UserAuthState {
  tokenVersion: number
  isVerified: boolean
}

type UserAuthStateReader = (userId: string) => Promise<UserAuthState | null>

const readUserAuthState: UserAuthStateReader = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true, isVerified: true },
  })
  return user
    ? { tokenVersion: user.tokenVersion, isVerified: user.isVerified }
    : null
}

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload
    }
  }
}

export function createAuthMiddleware(
  readAuthState: UserAuthStateReader = readUserAuthState,
  options: { permitUnverified?: boolean } = {}
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let decoded: JWTPayload
    try {
      const token = readCookie(req, env.AUTH_SESSION_COOKIE_NAME)
      if (!token) {
        res.status(401).json({ error: 'Missing or invalid session' })
        return
      }

      decoded = verifyToken(token)
    } catch {
      clearSessionCookies(res)
      res.status(401).json({ error: 'Invalid token' })
      return
    }

    try {
      const authState = await readAuthState(decoded.userId)
      if (
        authState === null ||
        !isTokenVersionCurrent(decoded, authState.tokenVersion)
      ) {
        clearSessionCookies(res)
        res.status(401).json({ error: 'Invalid or revoked token' })
        return
      }
      if (!options.permitUnverified && !authState.isVerified) {
        res.status(403).json({ error: 'Email verification required' })
        return
      }
      req.user = decoded
      next()
    } catch (error) {
      next(error)
    }
  }
}

export const authMiddleware = createAuthMiddleware()
export const accountLifecycleAuthMiddleware = createAuthMiddleware(readUserAuthState, {
  permitUnverified: true,
})
