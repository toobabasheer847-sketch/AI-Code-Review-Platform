import Stripe from 'stripe'
import { prisma } from '@/config/database'
import { env } from '@/config/env'
import { StripeService } from './stripe.service'
import {
  mapStripePriceToPlan,
  mapStripeSubscriptionStatus,
} from './stripe-mapping'

const stripeService = new StripeService()

function stripeCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer): string {
  return typeof customer === 'string' ? customer : customer.id
}

function isDuplicateStripeEvent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002' &&
    'meta' in error &&
    typeof error.meta === 'object' &&
    error.meta !== null &&
    'target' in error.meta &&
    Array.isArray(error.meta.target) &&
    error.meta.target.includes('id')
  )
}

export class BillingService {
  public async createCheckout(
    userId: string,
    email: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string
  ) {
    if (!env.STRIPE_PRO_PRICE_ID || priceId !== env.STRIPE_PRO_PRICE_ID) {
      throw new Error('The requested subscription price is not available')
    }
    await stripeService.createCustomerIfNotExists(userId, email)
    return stripeService.createCheckoutSession(userId, env.STRIPE_PRO_PRICE_ID, successUrl, cancelUrl)
  }

  public async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    const previouslyProcessed = await prisma.stripeEvent.findUnique({
      where: { id: event.id },
      select: { id: true },
    })
    if (previouslyProcessed) {
      return
    }

    const subscriptionEvent =
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'

    let customerId: string | null = null
    let metadataUserId: string | null = null
    let priceId: string | null = null
    let status: 'ACTIVE' | 'CANCELED' | 'EXPIRED' | null = null
    let currentPeriodStart: Date | null = null
    let currentPeriodEnd: Date | null = null

    if (subscriptionEvent) {
      const subscription = event.data.object
      customerId = stripeCustomerId(subscription.customer)
      metadataUserId = subscription.metadata.userId || null
      priceId = subscription.items.data[0]?.price.id ?? null
      status =
        event.type === 'customer.subscription.deleted'
          ? 'CANCELED'
          : mapStripeSubscriptionStatus(subscription.status)
      currentPeriodStart = new Date(subscription.current_period_start * 1000)
      currentPeriodEnd = new Date(subscription.current_period_end * 1000)

      const existing = await prisma.subscription.findUnique({
        where: { stripeId: customerId },
        select: { userId: true },
      })
      if (existing) {
        if (metadataUserId && existing.userId !== metadataUserId) {
          throw new Error('Stripe customer metadata does not match its linked user')
        }
        metadataUserId = existing.userId
      } else if (!metadataUserId) {
        metadataUserId = await stripeService.retrieveCustomerUserId(customerId)
      }

      if (!metadataUserId) {
        throw new Error(`No local user mapping found for Stripe customer ${customerId}`)
      }
      const localUser = await prisma.user.findUnique({
        where: { id: metadataUserId },
        select: { id: true },
      })
      if (!localUser) {
        await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } })
        return
      }
    }

    try {
      await prisma.$transaction(async (transaction) => {
        await transaction.stripeEvent.create({
          data: { id: event.id, type: event.type },
        })

        if (!subscriptionEvent || !customerId || !metadataUserId || !status) {
          return
        }

        const existing = await transaction.subscription.findUnique({
          where: { stripeId: customerId },
        })
        if (existing?.lastStripeEventCreatedAt && existing.lastStripeEventCreatedAt.getTime() >= event.created * 1000) {
          return
        }

        const plan = mapStripePriceToPlan(priceId, status, env.STRIPE_PRO_PRICE_ID)

        await transaction.subscription.upsert({
          where: { userId: metadataUserId },
          create: {
            userId: metadataUserId,
            stripeId: customerId,
            priceId,
            plan,
            status,
            currentPeriodStart,
            currentPeriodEnd,
            cancelledAt: status === 'CANCELED' ? currentPeriodEnd : null,
            lastStripeEventCreatedAt: new Date(event.created * 1000),
          },
          update: {
            stripeId: customerId,
            priceId,
            plan,
            status,
            currentPeriodStart,
            currentPeriodEnd,
            cancelledAt: status === 'CANCELED' ? currentPeriodEnd : null,
            lastStripeEventCreatedAt: new Date(event.created * 1000),
          },
        })
      })
    } catch (error) {
      if (isDuplicateStripeEvent(error)) {
        const alreadyProcessed = await prisma.stripeEvent.findUnique({
          where: { id: event.id },
          select: { id: true },
        })
        if (alreadyProcessed) {
          return
        }
      }
      throw error
    }
  }

  public async getSubscription(userId: string) {
    return prisma.subscription.findUnique({ where: { userId } })
  }

  public async getUsage(userId: string, month: number, year: number) {
    return prisma.usage.findUnique({
      where: { userId_month_year: { userId, month, year } },
    })
  }
}
