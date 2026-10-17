import { axiosInstance } from '@/lib/axios';
export const socialApi = {
    status: async () => {
        const response = await axiosInstance.get('/social/status');
        return response.data;
    },
    posts: async () => {
        const response = await axiosInstance.get('/social/posts');
        return response.data;
    },
    connectLinkedIn: async () => {
        const response = await axiosInstance.post('/social/linkedin/connect');
        return response.data.url;
    },
    disconnect: async (accountId) => {
        await axiosInstance.delete(`/social/accounts/${accountId}`);
    },
    generateDraft: async (instructions, reviewId, idempotencyKey) => {
        const response = await axiosInstance.post('/social/drafts/generate', { instructions, reviewId }, { headers: { 'Idempotency-Key': idempotencyKey } });
        return response.data;
    },
    createDraft: async (input, idempotencyKey) => {
        const response = await axiosInstance.post('/social/drafts', input, { headers: { 'Idempotency-Key': idempotencyKey } });
        return response.data;
    },
    updatePost: async (postId, input) => {
        const response = await axiosInstance.patch(`/social/posts/${postId}`, input);
        return response.data;
    },
    requestApproval: async (postId) => {
        const response = await axiosInstance.post(`/social/posts/${postId}/request-approval`);
        return response.data;
    },
    approve: async (postId) => {
        const response = await axiosInstance.post(`/social/posts/${postId}/approve`);
        return response.data;
    },
    reject: async (postId) => {
        const response = await axiosInstance.post(`/social/posts/${postId}/reject`);
        return response.data;
    },
    cancel: async (postId) => {
        const response = await axiosInstance.post(`/social/posts/${postId}/cancel`);
        return response.data;
    },
    retry: async (postId) => {
        const response = await axiosInstance.post(`/social/posts/${postId}/retry`);
        return response.data;
    },
};
