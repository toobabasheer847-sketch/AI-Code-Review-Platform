import axios from 'axios';
import Cookies from 'js-cookie';
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
export const axiosInstance = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
    },
});
// Request interceptor
axiosInstance.interceptors.request.use((config) => {
    const token = Cookies.get('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});
// Response interceptor
axiosInstance.interceptors.response.use((response) => response, (error) => {
    if (error.response?.status === 401) {
        Cookies.remove('token');
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        const isAuthPage = window.location.pathname === '/login' || window.location.pathname === '/register';
        if (!isAuthPage) {
            window.location.href = `/login?returnUrl=${returnUrl}`;
        }
    }
    return Promise.reject(error);
});
export default axiosInstance;
