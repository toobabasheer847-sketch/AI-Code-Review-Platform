import Cookies from 'js-cookie';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
const initialState = {
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    githubConnected: false,
    githubUsername: null,
    selectedPlan: null,
};
export const useAppStore = create()(persist((set) => ({
    ...initialState,
    setSelectedPlan: (selectedPlan) => set({ selectedPlan }),
    setUser: (user) => set({ user, isAuthenticated: !!user }),
    setToken: (token) => {
        if (token) {
            Cookies.set('token', token, {
                expires: 7,
                secure: window.location.protocol === 'https:',
                sameSite: 'strict',
            });
        }
        else {
            Cookies.remove('token');
        }
        set({ token });
    },
    setIsLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
    setGitHubConnected: (githubConnected) => set({ githubConnected }),
    setGitHubUsername: (githubUsername) => set({ githubUsername }),
    logout: () => {
        Cookies.remove('token');
        set(initialState);
    },
    reset: () => set(initialState),
}), {
    name: 'app-store',
    partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        githubConnected: state.githubConnected,
        githubUsername: state.githubUsername,
        selectedPlan: state.selectedPlan,
    }),
}));
