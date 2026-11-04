import type { Request, Response } from 'express'
import { z } from 'zod'
import { getAIUsageAnalytics } from './usage.analytics'
import logger from '@/utils/logger'

const querySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : date
}

export class AIUsageController {
  async get(req: Request, res: Response): Promise<void> {
    const userId = req.user?.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid usage analytics filters.' })
      return
    }

    const from = parseDate(parsed.data.from)
    const to = parseDate(parsed.data.to)
    if ((parsed.data.from && !from) || (parsed.data.to && !to) || (from && to && from > to)) {
      res.status(400).json({ error: 'Invalid usage analytics date range.' })
      return
    }
    const toExclusive = to ? new Date(to.getTime() + 24 * 60 * 60 * 1000) : undefined

    try {
      res.json(
        await getAIUsageAnalytics(userId, {
          from,
          toExclusive,
          page: parsed.data.page,
          pageSize: parsed.data.pageSize,
        })
      )
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'AI usage analytics request failed'
      )
      res.status(500).json({ error: 'Unable to load AI usage analytics.' })
    }
  }
}
