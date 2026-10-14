import { Request, Response, NextFunction } from 'express'
import { prisma } from '@/config/database'
import { FREE_MONTHLY_REVIEW_LIMIT, hasProReviewAccess } from '@/modules/billing/review-quota'

export async function subscriptionMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const sub = await prisma.subscription.findUnique({ where: { userId } })
    const now = new Date()
    if (hasProReviewAccess(sub, now)) {
      next()
      return
    }

    const month = now.getUTCMonth() + 1
    const year = now.getUTCFullYear()
    const usage = await prisma.usage.findUnique({
      where: { userId_month_year: { userId, month, year } },
    })
    const reviewCount = usage?.reviewCount ?? 0

    if (reviewCount >= FREE_MONTHLY_REVIEW_LIMIT) {
      res.status(402).json({ error: 'Free plan limit reached. Upgrade to Pro to continue.' })
      return
    }

    next()
  } catch {
    res.status(500).json({ error: 'Subscription check failed' })
  }
}
