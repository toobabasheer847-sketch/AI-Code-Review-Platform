import { prisma } from '@/config/database'
import { StripeService } from './stripe.service'

const stripeService = new StripeService()

export class BillingService {
  public async createCheckout(userId: string, email: string, priceId: string, successUrl: string, cancelUrl: string) {
    await stripeService.createCustomerIfNotExists(userId, email)
    const session = await stripeService.createCheckoutSession(userId, priceId, successUrl, cancelUrl)
    return session
  }

  public async handleWebhookEvent(event: any) {
    const type = event.type

    if (type === 'checkout.session.completed') {
      const session = event.data.object
      // session.customer is the customer id
      // No immediate DB update here; rely on subscription.created
    }

    if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
      const subscription = event.data.object
      const stripeCustomerId = subscription.customer as string
      const stripeSubscriptionId = subscription.id as string
      const priceId = subscription.items?.data?.[0]?.price?.id ?? null

      // find subscription by stripeId
      const existing = await prisma.subscription.findFirst({ where: { stripeId: stripeCustomerId } })

      if (existing) {
        await prisma.subscription.update({
          where: { id: existing.id },
          data: {
            stripeId: stripeCustomerId,
            priceId: priceId,
            status: 'ACTIVE',
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          },
        })
      } else {
        // If no subscription row exists, try to match user by stripe customer
        await prisma.subscription.create({
          data: {
            userId: '',
            stripeId: stripeCustomerId,
            priceId: priceId,
            plan: 'PRO',
            status: 'ACTIVE',
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          } as any,
        })
      }
    }

    if (type === 'customer.subscription.deleted') {
      const subscription = event.data.object
      const stripeCustomerId = subscription.customer as string
      const existing = await prisma.subscription.findFirst({ where: { stripeId: stripeCustomerId } })
      if (existing) {
        await prisma.subscription.update({ where: { id: existing.id }, data: { status: 'CANCELED' } })
      }
    }
  }

  public async getSubscription(userId: string) {
    const sub = await prisma.subscription.findUnique({ where: { userId } })
    return sub
  }

  public async getUsage(userId: string, month: number, year: number) {
    const usage = await prisma.usage.findUnique({ where: { userId_month_year: { userId, month, year } as any } }).catch(() => null)
    return usage
  }

  public async incrementUsage(userId: string) {
    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()

    const upsert = await prisma.usage.upsert({
      where: { userId_month_year: { userId, month, year } as any },
      update: { reviewCount: { increment: 1 } as any },
      create: { userId, month, year, reviewCount: 1 },
    })

    return upsert
  }
}
