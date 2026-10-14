export type LocalSubscriptionStatus = 'ACTIVE' | 'CANCELED' | 'EXPIRED'

export function mapStripeSubscriptionStatus(
  status: string,
  cancelAtPeriodEnd = false
): LocalSubscriptionStatus {
  if (cancelAtPeriodEnd) {
    return 'CANCELED'
  }
  if (status === 'active' || status === 'trialing') {
    return 'ACTIVE'
  }
  if (status === 'canceled') {
    return 'CANCELED'
  }
  return 'EXPIRED'
}

export function mapStripePriceToPlan(
  priceId: string | null,
  status: LocalSubscriptionStatus,
  configuredProPriceId: string
): 'FREE' | 'PRO' {
  return priceId === configuredProPriceId && status !== 'EXPIRED' ? 'PRO' : 'FREE'
}
