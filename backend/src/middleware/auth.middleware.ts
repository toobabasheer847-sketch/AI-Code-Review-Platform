import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '@/utils/jwt'
import type { JWTPayload } from '@/types'
import { prisma } from '@/config/database'

export function isTokenVersionCurrent(
  payload: JWTPayload,
  currentVersion: number
): boolean {
  return payload.tokenVersion === undefined
    ? currentVersion === 0
    : payload.tokenVersion === currentVersion
}

type TokenVersionReader = (userId: string) => Promise<number | null>

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload
    }
  }
}

export function createAuthMiddleware(
  readTokenVersion: TokenVersionReader = async (userId) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    })
    return user?.tokenVersion ?? null
  }
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let decoded: JWTPayload
    try {
      const authHeader = req.headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid authorization header' })
        return
      }

      const token = authHeader.substring(7)
      decoded = verifyToken(token)
    } catch {
      res.status(401).json({ error: 'Invalid token' })
      return
    }

    try {
      const tokenVersion = await readTokenVersion(decoded.userId)
      if (tokenVersion === null || !isTokenVersionCurrent(decoded, tokenVersion)) {
        res.status(401).json({ error: 'Invalid or revoked token' })
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
