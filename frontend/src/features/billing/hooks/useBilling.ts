import { useMutation, useQuery } from '@tanstack/react-query'
import { billingApi } from '../api/billingApi'

export const useCreateCheckout = () => {
  return useMutation({
    mutationFn: async (priceId: string) => {
      const res = await billingApi.createCheckout(priceId)
      return res
    },
  })
}

export const useBillingStatus = () => {
  return useQuery({ queryKey: ['billing', 'status'], queryFn: () => billingApi.getSubscription(), staleTime: 60_000 })
}

export const useUsage = () => {
  return useQuery({ queryKey: ['billing', 'usage'], queryFn: () => billingApi.getUsage(), staleTime: 30_000 })
}
