import axios from 'axios';
import { queryClient } from '@/lib/queryClient';
import { useAppStore } from '@/app/store/useAppStore';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const PUBLIC_AUTH_ENDPOINTS = new Set([
    '/auth/csrf',
    '/auth/login',
    '/auth/register',
    '/auth/verify-email',
    '/auth/verification-email/request',
    '/auth/password-reset/request',
    '/auth/password-reset/confirm',
]);
let csrfToken = null;
let csrfExpiresAt = 0;
let csrfRequest = null;

export const axiosInstance = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' },
});

function requestPath(config) {
    return (config.url ?? '').split('?')[0].replace(/\/+$/, '');
}

function getCsrfToken() {
    if (csrfToken && csrfExpiresAt - Date.now() > 30_000) return Promise.resolve(csrfToken);
    if (csrfRequest) return csrfRequest;
    csrfRequest = axiosInstance.get('/auth/csrf').then(({ data }) => {
        if (!data.csrfToken || !Number.isSafeInteger(data.expiresInMs) || data.expiresInMs <= 0) {
            throw new Error('The server returned an invalid CSRF token response');
        }
        csrfToken = data.csrfToken;
        csrfExpiresAt = Date.now() + data.expiresInMs;
        return csrfToken;
    }).finally(() => {
        csrfRequest = null;
    });
    return csrfRequest;
}

function clearCsrfToken() {
    csrfToken = null;
    csrfExpiresAt = 0;
    csrfRequest = null;
}

axiosInstance.interceptors.request.use(async (config) => {
    if (!['get', 'head', 'options'].includes((config.method ?? 'get').toLowerCase())) {
        config.headers['X-CSRF-Token'] = await getCsrfToken();
    }
    return config;
}, (error) => Promise.reject(error));

axiosInstance.interceptors.response.use((response) => {
    const path = response.config.url?.split('?')[0].replace(/\/+$/, '');
    if (['/auth/logout', '/auth/password-reset/confirm', '/auth/account'].includes(path)) {
        clearCsrfToken();
    }
    return response;
}, (error) => {
    if (error.response?.status === 403 && error.response.data?.code === 'CSRF_INVALID') {
        clearCsrfToken();
    }
    if (
        error.response?.status === 401 &&
        error.config &&
        !PUBLIC_AUTH_ENDPOINTS.has(requestPath(error.config)) &&
        useAppStore.getState().isAuthenticated
    ) {
        clearCsrfToken();
        useAppStore.getState().logout();
        queryClient.clear();
    }
    return Promise.reject(error);
});

export default axiosInstance;
