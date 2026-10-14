import { create } from 'zustand';
import { persist } from 'zustand/middleware';
const initialState = {
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
};
export const useAuthStore = create()(persist((set) => ({
    ...initialState,
    setUser: (user) => set({ user, isAuthenticated: !!user }),
    setToken: (token) => set({ token }),
    setIsLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
    logout: () => set(initialState),
    reset: () => set(initialState),
}), {
    name: 'auth-store',
    partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
    }),
}));
