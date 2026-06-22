import Stripe from 'stripe'
import { env } from '@/config/env'
import { prisma } from '@/config/database'

const stripeConfig = env.STRIPE_API_VERSION
  ? { apiVersion: env.STRIPE_API_VERSION as Stripe.StripeConfig['apiVersion'] }
  : {}
const stripe = new Stripe(env.STRIPE_SECRET_KEY, stripeConfig)

export class StripeService {
	public async createCustomerIfNotExists(userId: string, email: string) {
		const subscription = await prisma.subscription.findUnique({ where: { userId } })

		if (subscription?.stripeId) {
			try {
				const customer = await stripe.customers.retrieve(subscription.stripeId)
				return customer as Stripe.Customer
			} catch {
				// Continue to create a new customer
			}
		}

		const customer = await stripe.customers.create({ email })
		await prisma.subscription.upsert({
			where: { userId },
			update: { stripeId: customer.id },
			create: { userId, stripeId: customer.id, plan: 'FREE', status: 'ACTIVE' },
		})

		return customer
	}

	public async createCheckoutSession(userId: string, priceId: string, successUrl: string, cancelUrl: string) {
		const subscription = await prisma.subscription.findUnique({ where: { userId } })
		if (!subscription?.stripeId) throw new Error('Stripe customer not found')

		const session = await stripe.checkout.sessions.create({
			mode: 'subscription',
			customer: subscription.stripeId,
			line_items: [{ price: priceId, quantity: 1 }],
			success_url: successUrl,
			cancel_url: cancelUrl,
			payment_method_types: ['card'],
		})

		return session
	}

	public constructEvent(rawBody: Buffer, sig: string) {
		if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('Webhook secret not configured')
		return stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET)
	}
}
