export interface StripeEventClaimStore {
  createProcessing(eventId: string, eventType: string): Promise<boolean>
  findStatus(eventId: string): Promise<string | null>
  reclaimFailed(eventId: string): Promise<boolean>
  reclaimStale(eventId: string, before: Date): Promise<boolean>
}

export async function claimStripeEvent(
  store: StripeEventClaimStore,
  eventId: string,
  eventType: string,
  now = new Date()
): Promise<boolean> {
  if (await store.createProcessing(eventId, eventType)) return true

  const status = await store.findStatus(eventId)
  if (status === 'PROCESSED') return false
  if (status === 'FAILED' && await store.reclaimFailed(eventId)) return true

  const staleBefore = new Date(now.getTime() - 5 * 60 * 1000)
  if (status === 'PROCESSING' && await store.reclaimStale(eventId, staleBefore)) {
    return true
  }

  throw new Error('Stripe event is already being processed')
}
