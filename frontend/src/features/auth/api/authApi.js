/**
 * Auth API Service
 * Handles all authentication-related API calls
 */
import { axiosInstance } from '@/lib/axios';
export const authApi = {
    register: async (payload) => {
        const response = await axiosInstance.post('/auth/register', payload);
        return response.data;
    },
    login: async (payload) => {
        const response = await axiosInstance.post('/auth/login', payload);
        return response.data;
    },
    getCurrentUser: async () => {
        const response = await axiosInstance.get('/auth/me');
        return response.data;
    },
    logout: async () => {
        await axiosInstance.post('/auth/logout');
    },
    verifyEmail: async (token) => {
        const response = await axiosInstance.post('/auth/verify-email', { token });
        return response.data;
    },
    resendVerificationEmail: async () => {
        const response = await axiosInstance.post('/auth/verification-email');
        return response.data;
    },
    requestPasswordReset: async (email) => {
        const response = await axiosInstance.post('/auth/password-reset/request', { email });
        return response.data;
    },
    resetPassword: async (token, password) => {
        const response = await axiosInstance.post('/auth/password-reset/confirm', {
            token,
            password,
        });
        return response.data;
    },
    deleteAccount: async (password, confirmation) => {
        const response = await axiosInstance.delete('/auth/account', { data: { password, confirmation } });
        return response.data;
    },
};
