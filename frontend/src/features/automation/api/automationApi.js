import { axiosInstance } from '@/lib/axios';
export function getAutomationErrorMessage(error) {
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
    return error instanceof Error ? error.message : 'Unable to complete the automation request.';
}
export const automationApi = {
    list: async () => {
        const response = await axiosInstance.get('/automations');
        return response.data;
    },
    create: async (goal, mode, idempotencyKey) => {
        const response = await axiosInstance.post('/automations', { goal, mode }, { headers: { 'Idempotency-Key': idempotencyKey } });
        return response.data;
    },
    approve: async (id) => {
        const response = await axiosInstance.post(`/automations/${id}/approve`);
        return response.data;
    },
    reject: async (id) => {
        const response = await axiosInstance.post(`/automations/${id}/reject`);
        return response.data;
    },
    cancel: async (id) => {
        const response = await axiosInstance.post(`/automations/${id}/cancel`);
        return response.data;
    },
    retry: async (id) => {
        const response = await axiosInstance.post(`/automations/${id}/retry`);
        return response.data;
    },
};
