import { Request, Response } from 'express'
import { BillingService } from './billing.service'
import { StripeService } from './stripe.service'
import { z } from 'zod'
import logger from '@/utils/logger'
import { env } from '@/config/env'
import type Stripe from 'stripe'

const billingService = new BillingService()
const stripeService = new StripeService()

export class BillingController {
  async createCheckout(req: Request, res: Response): Promise<void> {
    const schema = z.object({ priceId: z.string().min(1).max(255) })
    let input: z.infer<typeof schema>
    try {
      input = schema.parse(req.body)
    } catch {
      res.status(400).json({ error: 'A valid subscription price is required.' })
      return
    }

    if (!req.user?.userId || !req.user.email) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const frontendUrl = env.FRONTEND_URL.replace(/\/+$/, '')
    const successUrl = `${frontendUrl}/billing/success`
    const cancelUrl = `${frontendUrl}/billing/cancel`

    try {
      const session = await billingService.createCheckout(
        req.user.userId,
        req.user.email,
        input.priceId,
        successUrl,
        cancelUrl
      )
      if (!session.url) {
        res.status(502).json({ error: 'Stripe did not provide a checkout URL. Please retry.' })
        return
      }
      res.json({ url: session.url })
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'The requested subscription price is not available' ||
          error.message === 'A Pro subscription is already active for this account')
      ) {
        res.status(409).json({ error: error.message })
        return
      }
      logger.error('Stripe checkout session creation failed')
      res.status(502).json({ error: 'Unable to start checkout. Please retry later.' })
    }
  }

  async webhook(req: Request, res: Response): Promise<void> {
    const signature = req.headers['stripe-signature']
    if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'Invalid Stripe webhook request' })
      return
    }

    let event: Stripe.Event
    try {
      event = stripeService.constructEvent(req.body, signature)
    } catch {
      res.status(400).json({ error: 'Invalid Stripe webhook signature or payload' })
      return
    }

    try {
      await billingService.handleWebhookEvent(event)
      res.json({ received: true })
    } catch (error) {
      logger.error(
        { eventId: event.id, eventType: event.type, errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Stripe webhook processing failed'
      )
      res.status(500).json({ error: 'Stripe event processing failed. Stripe may retry this event.' })
    }
  }

  async cancelSubscription(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    try {
      const currentPeriodEnd = await billingService.cancelSubscription(req.user.userId)
      res.json({ status: 'CANCELED', currentPeriodEnd })
    } catch (error) {
      if (error instanceof Error && error.message.includes('No ')) {
        res.status(409).json({ error: 'No active Pro subscription is available to cancel.' })
        return
      }
      logger.error('Stripe subscription cancellation failed')
      res.status(502).json({ error: 'Unable to cancel the subscription. Please retry later.' })
    }
  }

  async getSubscription(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const sub = await billingService.getSubscription(req.user.userId)
      res.json(sub)
    } catch {
      logger.error('Failed to read subscription status')
      res.status(500).json({ error: 'Unable to load subscription status.' })
    }
  }

  async getUsage(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const now = new Date()
      const month = now.getUTCMonth() + 1
      const year = now.getUTCFullYear()
      const usage = await billingService.getUsage(req.user.userId, month, year)
      res.json(usage)
    } catch {
      logger.error('Failed to read billing usage')
      res.status(500).json({ error: 'Unable to load billing usage.' })
    }
  }
}
