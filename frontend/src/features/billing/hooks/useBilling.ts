import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'

import { billingApi, type BillingSubscription, type BillingUsage } from '../api/billingApi'

export const useCreateCheckout = (): UseMutationResult<{ url: string | null }, Error, string> => {
  return useMutation<{ url: string | null }, Error, string>({
    mutationFn: async (priceId: string) => {
      const res = await billingApi.createCheckout(priceId)
      return res
    },
  })
}

export const useCancelSubscription = (): UseMutationResult<
  { status: 'CANCELED'; currentPeriodEnd: string },
  Error,
  void
> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => billingApi.cancelSubscription(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['billing'] })
    },
  })
}

export const useBillingStatus = (): UseQueryResult<BillingSubscription | null, Error> => {
  return useQuery<BillingSubscription | null, Error>({
    queryKey: ['billing', 'status'],
    queryFn: () => billingApi.getSubscription(),
    staleTime: 60_000,
  })
}

export const useUsage = (): UseQueryResult<BillingUsage | null, Error> => {
  return useQuery<BillingUsage | null, Error>({
    queryKey: ['billing', 'usage'],
    queryFn: () => billingApi.getUsage(),
    staleTime: 30_000,
  })
}
