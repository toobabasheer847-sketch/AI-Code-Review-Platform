import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '../api/billingApi';
export const useCreateCheckout = () => {
    return useMutation({
        mutationFn: async (priceId) => {
            const res = await billingApi.createCheckout(priceId);
            return res;
        },
    });
};
export const useCancelSubscription = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => billingApi.cancelSubscription(),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['billing'] });
        },
    });
};
export const useBillingStatus = () => {
    return useQuery({
        queryKey: ['billing', 'status'],
        queryFn: () => billingApi.getSubscription(),
        staleTime: 60000,
    });
};
export const useUsage = () => {
    return useQuery({
        queryKey: ['billing', 'usage'],
        queryFn: () => billingApi.getUsage(),
        staleTime: 30000,
    });
};
