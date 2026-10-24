import { axiosInstance } from '@/lib/axios';

export const findingStatuses = [
    'UNREVIEWED',
    'CONFIRMED',
    'FALSE_POSITIVE',
    'DUPLICATE',
    'FIXED',
    'WONT_FIX',
];

export const reviewApi = {
    list: async () => {
        const res = await axiosInstance.get('/reviews');
        return res.data;
    },
    get: async (id) => {
        const res = await axiosInstance.get(`/reviews/${id}`);
        return res.data;
    },
    start: async (repository, branch = 'main') => {
        const res = await axiosInstance.post('/reviews/start', { repository, branch });
        return res.data;
    },
    updateFindingStatus: async (findingId, input) => {
        const res = await axiosInstance.patch(`/reviews/findings/${findingId}/status`, input);
        return res.data;
    },
    createFixProposal: async (findingId, patch) => {
        const res = await axiosInstance.post(`/reviews/findings/${findingId}/fix-proposals`, { patch });
        return res.data;
    },
    requestFindingVerification: async (findingId, input) => {
        const res = await axiosInstance.post(`/reviews/findings/${findingId}/verification-requests`, input);
        return res.data;
    },
    getFindingVerification: async (findingId, requestKey) => {
        const res = await axiosInstance.get(`/reviews/findings/${findingId}/verification-requests/${encodeURIComponent(requestKey)}`);
        return res.data;
    },
};
