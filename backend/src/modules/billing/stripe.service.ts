import Stripe from 'stripe'
import { env } from '@/config/env'
import { prisma } from '@/config/database'

const stripeConfig = env.STRIPE_API_VERSION
  ? { apiVersion: env.STRIPE_API_VERSION as Stripe.StripeConfig['apiVersion'] }
  : {}
export class StripeService {
  private stripeClient: Stripe | undefined
  private readonly webhookSecret: string

  constructor(stripeClient?: Stripe, webhookSecret = env.STRIPE_WEBHOOK_SECRET) {
    this.stripeClient = stripeClient
    this.webhookSecret = webhookSecret
  }

  private getStripeClient(): Stripe {
    if (!this.stripeClient) {
      if (!env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured')
      this.stripeClient = new Stripe(env.STRIPE_SECRET_KEY, stripeConfig)
    }
    return this.stripeClient
  }

	public async createCustomerIfNotExists(userId: string, email: string) {
		const subscription = await prisma.subscription.findUnique({ where: { userId } })

		if (subscription?.stripeId) {
			const customer = await this.getStripeClient().customers.retrieve(subscription.stripeId)
			if (!customer.deleted) {
				return customer
			}
		}

		const customer = await this.getStripeClient().customers.create(
			{ email, metadata: { userId } },
			{ idempotencyKey: `customer-${userId}` }
		)
		await prisma.subscription.upsert({
			where: { userId },
			update: {
				stripeId: customer.id,
				plan: 'FREE',
				status: 'ACTIVE',
				priceId: null,
				currentPeriodStart: null,
				currentPeriodEnd: null,
				cancelledAt: null,
			},
			create: {
				userId,
				stripeId: customer.id,
				plan: 'FREE',
				status: 'ACTIVE',
			},
		})

		return customer
	}

	public async createCheckoutSession(userId: string, priceId: string, successUrl: string, cancelUrl: string) {
		const subscription = await prisma.subscription.findUnique({ where: { userId } })
		if (!subscription?.stripeId) throw new Error('Stripe customer not found')

		const session = await this.getStripeClient().checkout.sessions.create({
			mode: 'subscription',
			customer: subscription.stripeId,
			line_items: [{ price: priceId, quantity: 1 }],
			client_reference_id: userId,
			metadata: { userId },
			subscription_data: { metadata: { userId } },
			success_url: successUrl,
			cancel_url: cancelUrl,
			payment_method_types: ['card'],
		})

		return session
	}

	public async retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
		return this.getStripeClient().subscriptions.retrieve(subscriptionId)
	}

	public async cancelProSubscription(userId: string): Promise<Date> {
		const localSubscription = await prisma.subscription.findUnique({
			where: { userId },
			select: { stripeId: true, plan: true, status: true, currentPeriodEnd: true },
		})
		if (!localSubscription?.stripeId || localSubscription.plan !== 'PRO') {
			throw new Error('No Pro subscription is available to cancel')
		}
		if (localSubscription.status === 'CANCELED' && localSubscription.currentPeriodEnd) {
			return localSubscription.currentPeriodEnd
		}

		const subscriptions = await this.getStripeClient().subscriptions.list({
			customer: localSubscription.stripeId,
			status: 'all',
			limit: 100,
		})
		const activeSubscription = subscriptions.data.find(
			(subscription) =>
				(subscription.status === 'active' || subscription.status === 'trialing') &&
				subscription.items.data.some((item) => item.price.id === env.STRIPE_PRO_PRICE_ID)
		)
		if (!activeSubscription) {
			throw new Error('No active Pro subscription is available to cancel')
		}

		const canceledSubscription = activeSubscription.cancel_at_period_end
			? activeSubscription
			: await this.getStripeClient().subscriptions.update(activeSubscription.id, {
					cancel_at_period_end: true,
				})
		const currentPeriodEnd = new Date(canceledSubscription.current_period_end * 1000)
		await prisma.subscription.update({
			where: { userId },
			data: {
				status: 'CANCELED',
				currentPeriodEnd,
				cancelledAt: currentPeriodEnd,
			},
		})
		return currentPeriodEnd
	}

	public async retrieveCustomerUserId(customerId: string): Promise<string | null> {
		const customer = await this.getStripeClient().customers.retrieve(customerId)
		return customer.deleted ? null : customer.metadata.userId || null
	}

	public constructEvent(rawBody: Buffer, sig: string) {
		if (!this.webhookSecret) throw new Error('Webhook secret not configured')
		return this.getStripeClient().webhooks.constructEvent(rawBody, sig, this.webhookSecret)
	}
}
