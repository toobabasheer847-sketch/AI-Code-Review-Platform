import axiosInstance from '@/lib/axios';
export function getBillingErrorMessage(error, fallback) {
    if (typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof error.response === 'object' &&
        error.response !== null &&
        'data' in error.response &&
        typeof error.response.data === 'object' &&
        error.response.data !== null &&
        'error' in error.response.data &&
        typeof error.response.data.error === 'string') {
        return error.response.data.error;
    }
    return error instanceof Error ? error.message : fallback;
}
export const billingApi = {
    createCheckout: async (priceId) => {
        const res = await axiosInstance.post('/billing/create-checkout', { priceId });
        return res.data;
    },
    getSubscription: async () => {
        const res = await axiosInstance.get('/billing/subscription');
        return res.data;
    },
    getUsage: async () => {
        const res = await axiosInstance.get('/billing/usage');
        return res.data;
    },
    cancelSubscription: async () => {
        const res = await axiosInstance.post('/billing/cancel-subscription');
        return res.data;
    },
};
