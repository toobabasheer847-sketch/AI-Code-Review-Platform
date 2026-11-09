import assert from 'node:assert/strict'
import test from 'node:test'
import Stripe from 'stripe'
import { readStripeIntegrationTarget } from '@/testing/provider-test-env'
import { claimStripeEvent, type StripeEventClaimStore } from './stripe-event-claim'
import { StripeService } from './stripe.service'

const webhookSecret = 'whsec_integration_test_secret'

function memoryClaimStore(): StripeEventClaimStore & { statuses: Map<string, string> } {
  const statuses = new Map<string, string>()
  return {
    statuses,
    async createProcessing(eventId) {
      if (statuses.has(eventId)) return false
      statuses.set(eventId, 'PROCESSING')
      return true
    },
    async findStatus(eventId) {
      return statuses.get(eventId) ?? null
    },
    async reclaimFailed(eventId) {
      if (statuses.get(eventId) !== 'FAILED') return false
      statuses.set(eventId, 'PROCESSING')
      return true
    },
    async reclaimStale() {
      return false
    },
  }
}

test('validates Stripe webhook signatures and rejects a tampered signature', () => {
  const stripe = new Stripe('sk_test_integration_signature_only')
  const service = new StripeService(stripe, webhookSecret)
  const payload = JSON.stringify({
    id: 'evt_integration_signature',
    object: 'event',
    type: 'customer.created',
    data: { object: { id: 'cus_integration' } },
  })
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret })
  const event = service.constructEvent(Buffer.from(payload), header)
  assert.equal(event.id, 'evt_integration_signature')
  assert.throws(
    () => service.constructEvent(Buffer.from(payload), 't=1,v1=deadbeef'),
    (error: unknown) => {
      assert.equal(error instanceof Error && error.message.includes(webhookSecret), false)
      return true
    }
  )
})

test('claims a webhook once and rejects the duplicate while it is processing', async () => {
  const store = memoryClaimStore()
  assert.equal(await claimStripeEvent(store, 'evt_integration_once', 'customer.created'), true)
  await assert.rejects(
    () => claimStripeEvent(store, 'evt_integration_once', 'customer.created'),
    /already being processed/
  )
  store.statuses.set('evt_integration_once', 'PROCESSED')
  assert.equal(await claimStripeEvent(store, 'evt_integration_once', 'customer.created'), false)
})

const stripeTarget = readStripeIntegrationTarget()

test(
  'creates a test-mode customer, checkout session, and subscription without a live charge',
  { skip: stripeTarget ? false : 'Set RUN_STRIPE_INTEGRATION_TEST=1 and STRIPE_INTEGRATION_SECRET_KEY=sk_test_...' },
  async () => {
    assert.ok(stripeTarget)
    const stripe = new Stripe(stripeTarget.secretKey)
    const email = `stripe-integration-${Date.now()}@example.test`
    const customer = await stripe.customers.create({
      email,
      metadata: { purpose: 'ai-codeguard-integration-test' },
    })
    const product = await stripe.products.create({ name: 'AI CodeGuard integration test' })
    const price = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: 100,
      recurring: { interval: 'month' },
    })
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customer.id,
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: 'https://example.test/billing/success',
        cancel_url: 'https://example.test/billing/cancel',
      })
      assert.equal(session.mode, 'subscription')
      assert.equal(typeof session.url, 'string')
      assert.equal(JSON.stringify(session).includes(stripeTarget.secretKey), false)

      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
        payment_behavior: 'default_incomplete',
      })
      assert.equal(subscription.status === 'incomplete' || subscription.status === 'active', true)
      const canceled = await stripe.subscriptions.cancel(subscription.id)
      assert.equal(canceled.status, 'canceled')
    } finally {
      await stripe.customers.del(customer.id)
      await stripe.products.update(product.id, { active: false })
    }
  }
)
