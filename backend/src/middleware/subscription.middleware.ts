import { Request, Response, NextFunction } from 'express'
import { prisma } from '@/config/database'

export async function subscriptionMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const sub = await prisma.subscription.findUnique({ where: { userId } })
    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()
    const usage = await prisma.usage.findUnique({ where: { userId_month_year: { userId, month, year } as any } }).catch(() => null)

    const reviewCount = usage?.reviewCount ?? 0

    if (!sub || sub.plan === 'FREE') {
      const limit = 3
      if (reviewCount >= limit) {
        res.status(402).json({ error: 'Free plan limit reached. Upgrade to Pro to continue.' })
        return
      }
    }

    next()
  } catch (error) {
    res.status(500).json({ error: 'Subscription check failed' })
  }
}
