import axiosInstance from '@/lib/axios'

export const billingApi = {
  createCheckout: async (priceId: string) => {
    const res = await axiosInstance.post('/billing/create-checkout', { priceId })
    return res.data
  },
  getSubscription: async () => {
    const res = await axiosInstance.get('/billing/subscription')
    return res.data
  },
  getUsage: async () => {
    const res = await axiosInstance.get('/billing/usage')
    return res.data
  },
}
