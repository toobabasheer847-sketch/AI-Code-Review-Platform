/**
 * Auth Hooks
 * React Query hooks for authentication operations
 */
import { useMutation, useQuery, useQueryClient, } from '@tanstack/react-query';
import { useAppStore } from '@/app/store/useAppStore';
import { authApi, } from '../api/authApi';
/**
 * Hook for user registration
 */
export const useRegister = () => {
    const setUser = useAppStore((state) => state.setUser);
    const setToken = useAppStore((state) => state.setToken);
    const setIsLoading = useAppStore((state) => state.setIsLoading);
    const setError = useAppStore((state) => state.setError);
    return useMutation({
        mutationFn: async (payload) => {
            setIsLoading(true);
            try {
                return await authApi.register(payload);
            }
            finally {
                setIsLoading(false);
            }
        },
        onSuccess: (data) => {
            setToken(data.token);
            setUser(data.user);
            setError(null);
        },
        onError: (error) => {
            setError(error.message || 'Registration failed');
        },
    });
};
/**
 * Hook for user login
 */
export const useLogin = () => {
    const setUser = useAppStore((state) => state.setUser);
    const setToken = useAppStore((state) => state.setToken);
    const setIsLoading = useAppStore((state) => state.setIsLoading);
    const setError = useAppStore((state) => state.setError);
    return useMutation({
        mutationFn: async (payload) => {
            setIsLoading(true);
            try {
                return await authApi.login(payload);
            }
            finally {
                setIsLoading(false);
            }
        },
        onSuccess: (data) => {
            setToken(data.token);
            setUser(data.user);
            setError(null);
        },
        onError: (error) => {
            setError(error.message || 'Login failed');
        },
    });
};
/**
 * Hook for fetching current user (protected)
 */
export const useMe = () => {
    const token = useAppStore((state) => state.token);
    const setUser = useAppStore((state) => state.setUser);
    return useQuery({
        queryKey: ['me'],
        queryFn: async () => {
            const response = await authApi.getCurrentUser();
            setUser(response.user);
            return response.user;
        },
        enabled: !!token,
        staleTime: 5 * 60 * 1000, // 5 minutes
        retry: 1,
    });
};
/**
 * Hook for logout
 */
export const useLogout = () => {
    const queryClient = useQueryClient();
    const logout = useAppStore((state) => state.logout);
    return useMutation({
        mutationFn: () => authApi.logout(),
        onSuccess: () => {
            logout();
            queryClient.clear();
        },
    });
};
