import Stripe from 'stripe'
import { prisma } from '@/config/database'
import { env } from '@/config/env'
import { StripeService } from './stripe.service'
import {
  mapStripePriceToPlan,
  mapStripeSubscriptionStatus,
} from './stripe-mapping'
import { hasProReviewAccess } from './review-quota'
import { claimStripeEvent } from './stripe-event-claim'

type BillingState = {
  customerId: string
  userId: string
  priceId: string | null
  status: 'ACTIVE' | 'CANCELED' | 'EXPIRED'
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
}

const subscriptionEventTypes = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])
const invoiceEventTypes = new Set([
  'invoice.payment_succeeded',
  'invoice.payment_failed',
])

function stripeCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer): string {
  return typeof customer === 'string' ? customer : customer.id
}

function stripeSubscriptionId(subscription: string | Stripe.Subscription | null): string | null {
  if (!subscription) return null
  return typeof subscription === 'string' ? subscription : subscription.id
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
  constructor(private readonly stripeService = new StripeService()) {}

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
    const currentSubscription = await prisma.subscription.findUnique({
      where: { userId },
      select: { plan: true, status: true, currentPeriodEnd: true },
    })
    if (hasProReviewAccess(currentSubscription, new Date())) {
      throw new Error('A Pro subscription is already active for this account')
    }
    await this.stripeService.createCustomerIfNotExists(userId, email)
    return this.stripeService.createCheckoutSession(
      userId,
      env.STRIPE_PRO_PRICE_ID,
      successUrl,
      cancelUrl
    )
  }

  public async cancelSubscription(userId: string): Promise<Date> {
    return this.stripeService.cancelProSubscription(userId)
  }

  public async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    if (!(await this.claimEvent(event))) return

    try {
      const state = await this.getEventBillingState(event)
      await prisma.$transaction(async (transaction) => {
        if (state) {
          const existing = await transaction.subscription.findUnique({
            where: { stripeId: state.customerId },
          })
          if (
            !existing?.lastStripeEventCreatedAt ||
            existing.lastStripeEventCreatedAt.getTime() < event.created * 1000
          ) {
            await transaction.subscription.upsert({
              where: { userId: state.userId },
              create: {
                userId: state.userId,
                stripeId: state.customerId,
                priceId: state.priceId,
                plan: mapStripePriceToPlan(
                  state.priceId,
                  state.status,
                  env.STRIPE_PRO_PRICE_ID
                ),
                status: state.status,
                currentPeriodStart: state.currentPeriodStart,
                currentPeriodEnd: state.currentPeriodEnd,
                cancelledAt: state.status === 'CANCELED' ? state.currentPeriodEnd : null,
                lastStripeEventCreatedAt: new Date(event.created * 1000),
              },
              update: {
                stripeId: state.customerId,
                priceId: state.priceId,
                plan: mapStripePriceToPlan(
                  state.priceId,
                  state.status,
                  env.STRIPE_PRO_PRICE_ID
                ),
                status: state.status,
                currentPeriodStart: state.currentPeriodStart,
                currentPeriodEnd: state.currentPeriodEnd,
                cancelledAt: state.status === 'CANCELED' ? state.currentPeriodEnd : null,
                lastStripeEventCreatedAt: new Date(event.created * 1000),
              },
            })
          }
        }

        await transaction.stripeEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSED', errorMessage: null },
        })
      })
    } catch (error) {
      const errorType =
        error instanceof Error
          ? error.name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'Error'
          : 'UnknownError'
      try {
        await prisma.stripeEvent.updateMany({
          where: { id: event.id, status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            errorMessage: `Processing failed (${errorType}). See sanitized backend logs before retry.`,
          },
        })
      } catch (statusError) {
        throw new AggregateError(
          [error, statusError],
          'Stripe event processing and failure recording both failed'
        )
      }
      throw error
    }
  }

  private async claimEvent(event: Stripe.Event): Promise<boolean> {
    return claimStripeEvent(
      {
        async createProcessing(eventId, eventType) {
          try {
            await prisma.stripeEvent.create({
              data: { id: eventId, type: eventType, status: 'PROCESSING' },
            })
            return true
          } catch (error) {
            if (!isDuplicateStripeEvent(error)) throw error
            return false
          }
        },
        async findStatus(eventId) {
          const eventRecord = await prisma.stripeEvent.findUnique({
            where: { id: eventId },
            select: { status: true },
          })
          return eventRecord?.status ?? null
        },
        async reclaimFailed(eventId) {
          const reclaimed = await prisma.stripeEvent.updateMany({
            where: { id: eventId, status: 'FAILED' },
            data: { status: 'PROCESSING', errorMessage: null },
          })
          return reclaimed.count === 1
        },
        async reclaimStale(eventId, before) {
          const reclaimed = await prisma.stripeEvent.updateMany({
            where: {
              id: eventId,
              status: 'PROCESSING',
              updatedAt: { lt: before },
            },
            data: { errorMessage: null },
          })
          return reclaimed.count === 1
        },
      },
      event.id,
      event.type
    )
  }

  private async getEventBillingState(event: Stripe.Event): Promise<BillingState | null> {
    if (subscriptionEventTypes.has(event.type)) {
      const subscription = event.data.object as Stripe.Subscription
      return this.mapSubscription(subscription, event.type)
    }

    if (!invoiceEventTypes.has(event.type)) return null

    const invoice = event.data.object as Stripe.Invoice
    const subscriptionId = stripeSubscriptionId(invoice.subscription)
    if (!subscriptionId || !invoice.customer) return null

    if (event.type === 'invoice.payment_failed') {
      const customerId = stripeCustomerId(invoice.customer)
      const local = await prisma.subscription.findUnique({
        where: { stripeId: customerId },
        select: { userId: true, priceId: true, currentPeriodStart: true, currentPeriodEnd: true },
      })
      if (!local) return null
      return {
        customerId,
        userId: local.userId,
        priceId: local.priceId,
        status: 'EXPIRED',
        currentPeriodStart: local.currentPeriodStart,
        currentPeriodEnd: local.currentPeriodEnd,
      }
    }

    const subscription = await this.stripeService.retrieveSubscription(subscriptionId)
    if (stripeCustomerId(subscription.customer) !== stripeCustomerId(invoice.customer)) {
      throw new Error('Stripe invoice customer does not match its subscription')
    }
    return this.mapSubscription(subscription, event.type)
  }

  private async mapSubscription(
    subscription: Stripe.Subscription,
    eventType: string
  ): Promise<BillingState | null> {
    const customerId = stripeCustomerId(subscription.customer)
    let userId = subscription.metadata.userId || null
    const existing = await prisma.subscription.findUnique({
      where: { stripeId: customerId },
      select: { userId: true },
    })
    if (existing) {
      if (userId && existing.userId !== userId) {
        throw new Error('Stripe customer metadata does not match its linked user')
      }
      userId = existing.userId
    } else if (!userId) {
      userId = await this.stripeService.retrieveCustomerUserId(customerId)
    }

    if (!userId) throw new Error('No local user mapping found for Stripe customer')
    const localUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    })
    if (!localUser) return null

    const status =
      eventType === 'customer.subscription.deleted'
        ? 'CANCELED'
        : mapStripeSubscriptionStatus(subscription.status, subscription.cancel_at_period_end)
    return {
      customerId,
      userId,
      priceId: subscription.items.data[0]?.price.id ?? null,
      status,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    }
  }

  public async getSubscription(userId: string) {
    return prisma.subscription.findUnique({
      where: { userId },
      select: { plan: true, status: true, currentPeriodEnd: true },
    })
  }

  public async getUsage(userId: string, month: number, year: number) {
    return prisma.usage.findUnique({
      where: { userId_month_year: { userId, month, year } },
    })
  }
}
