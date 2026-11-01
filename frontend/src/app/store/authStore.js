import { create } from 'zustand';
const initialState = {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
};
export const useAuthStore = create()((set) => ({
    ...initialState,
    setUser: (user) => set({ user, isAuthenticated: !!user }),
    setIsLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
    logout: () => set(initialState),
    reset: () => set(initialState),
}));
