import { Request, Response } from 'express'
import { BillingService } from './billing.service'
import { StripeService } from './stripe.service'
import { z } from 'zod'

const billingService = new BillingService()
const stripeService = new StripeService()

export class BillingController {
  async createCheckout(req: Request, res: Response): Promise<void> {
    try {
      const schema = z.object({ priceId: z.string().min(1) })
      const input = schema.parse(req.body)

      if (!req.user?.userId || !req.user.email) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const successUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/billing/success`
      const cancelUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/billing/cancel`

      const session = await billingService.createCheckout(req.user.userId, req.user.email, input.priceId, successUrl, cancelUrl)
      res.json({ url: session.url })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create checkout'
      res.status(400).json({ error: message })
    }
  }

  async webhook(req: Request, res: Response): Promise<void> {
    try {
      const signature = req.headers['stripe-signature']
      if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: 'Invalid Stripe webhook request' })
        return
      }

      const event = stripeService.constructEvent(req.body, signature)

      await billingService.handleWebhookEvent(event)

      res.json({ received: true })
    } catch (error) {
      res.status(400).json({ error: (error as Error).message })
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
    } catch (error) {
      res.status(400).json({ error: (error as Error).message })
    }
  }

  async getUsage(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const now = new Date()
      const month = now.getMonth() + 1
      const year = now.getFullYear()
      const usage = await billingService.getUsage(req.user.userId, month, year)
      res.json(usage)
    } catch (error) {
      res.status(400).json({ error: (error as Error).message })
    }
  }
}
