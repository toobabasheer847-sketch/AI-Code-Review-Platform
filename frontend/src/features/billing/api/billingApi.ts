import axiosInstance from '@/lib/axios'

export function getBillingErrorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response &&
    typeof error.response.data === 'object' &&
    error.response.data !== null &&
    'error' in error.response.data &&
    typeof error.response.data.error === 'string'
  ) {
    return error.response.data.error
  }
  return error instanceof Error ? error.message : fallback
}

export interface BillingSubscription {
  plan: 'FREE' | 'PRO'
  status: 'ACTIVE' | 'CANCELED' | 'EXPIRED'
  currentPeriodEnd: string | null
}

export interface BillingUsage {
  reviewCount: number
  month: number
  year: number
}

export const billingApi = {
  createCheckout: async (priceId: string): Promise<{ url: string | null }> => {
    const res = await axiosInstance.post<{ url: string | null }>('/billing/create-checkout', { priceId })
    return res.data
  },
  getSubscription: async (): Promise<BillingSubscription | null> => {
    const res = await axiosInstance.get<BillingSubscription | null>('/billing/subscription')
    return res.data
  },
  getUsage: async (): Promise<BillingUsage | null> => {
    const res = await axiosInstance.get<BillingUsage | null>('/billing/usage')
    return res.data
  },
  cancelSubscription: async (): Promise<{ status: 'CANCELED'; currentPeriodEnd: string }> => {
    const res = await axiosInstance.post<{ status: 'CANCELED'; currentPeriodEnd: string }>(
      '/billing/cancel-subscription'
    )
    return res.data
  },
}
