import assert from 'node:assert/strict'
import test from 'node:test'
import { FREE_MONTHLY_REVIEW_LIMIT, hasProReviewAccess } from './review-quota'
import {
  mapStripePriceToPlan,
  mapStripeSubscriptionStatus,
} from './stripe-mapping'

test('maps Stripe subscription states without granting access to delinquent subscriptions', () => {
  assert.equal(mapStripeSubscriptionStatus('active'), 'ACTIVE')
  assert.equal(mapStripeSubscriptionStatus('active', true), 'CANCELED')
  assert.equal(mapStripeSubscriptionStatus('trialing', true), 'CANCELED')
  assert.equal(mapStripeSubscriptionStatus('trialing'), 'ACTIVE')
  assert.equal(mapStripeSubscriptionStatus('canceled'), 'CANCELED')
  assert.equal(mapStripeSubscriptionStatus('past_due'), 'EXPIRED')
  assert.equal(mapStripeSubscriptionStatus('incomplete'), 'EXPIRED')
})

test('only the configured Pro price maps to Pro', () => {
  assert.equal(mapStripePriceToPlan('price_pro', 'ACTIVE', 'price_pro'), 'PRO')
  assert.equal(mapStripePriceToPlan('price_pro', 'CANCELED', 'price_pro'), 'PRO')
  assert.equal(mapStripePriceToPlan('price_unknown', 'ACTIVE', 'price_pro'), 'FREE')
  assert.equal(mapStripePriceToPlan('price_pro', 'EXPIRED', 'price_pro'), 'FREE')
  assert.equal(mapStripePriceToPlan('price_pro', 'ACTIVE', ''), 'FREE')
})

test('honors active Pro period and expires it after its period end', () => {
  const now = new Date('2026-10-11T00:00:00.000Z')
  assert.equal(
    hasProReviewAccess(
      { plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z') },
      now
    ),
    true
  )
  assert.equal(
    hasProReviewAccess(
      { plan: 'PRO', status: 'CANCELED', currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z') },
      now
    ),
    true
  )
  assert.equal(
    hasProReviewAccess(
      { plan: 'PRO', status: 'CANCELED', currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z') },
      now
    ),
    false
  )
  assert.equal(
    hasProReviewAccess({ plan: 'PRO', status: 'EXPIRED', currentPeriodEnd: null }, now),
    false
  )
})

test('preserves the free review quota and keeps free subscriptions outside Pro access', () => {
  assert.equal(FREE_MONTHLY_REVIEW_LIMIT, 3)
  assert.equal(
    hasProReviewAccess(
      { plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null },
      new Date('2026-10-11T00:00:00.000Z')
    ),
    false
  )
})
