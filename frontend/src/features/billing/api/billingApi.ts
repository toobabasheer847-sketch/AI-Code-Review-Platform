import axiosInstance from '@/lib/axios'

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
}
