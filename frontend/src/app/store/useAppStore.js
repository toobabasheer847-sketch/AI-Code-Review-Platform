import Cookies from 'js-cookie';
import { create } from 'zustand';

const initialState = {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    githubConnected: false,
    githubUsername: null,
    selectedPlan: null,
};
const SESSION_INVALIDATION_KEY = 'ai-codeguard-session-invalidated';
const SESSION_CHANNEL_NAME = 'ai-codeguard-session';

if (typeof window !== 'undefined') {
    try {
        window.localStorage.removeItem('app-store');
        window.localStorage.removeItem('auth-store');
    }
    catch {
        console.warn('Unable to clear legacy authentication state from browser storage');
    }
    try {
        const cookieOptions = { secure: window.location.protocol === 'https:' };
        Cookies.remove('token', cookieOptions);
        Cookies.remove('token', { ...cookieOptions, path: '/' });
    }
    catch {
        console.warn('Unable to clear the legacy readable authentication cookie');
    }
}

export const useAppStore = create((set) => ({
    ...initialState,
    setSelectedPlan: (selectedPlan) => set({ selectedPlan }),
    setUser: (user) => set({ user, isAuthenticated: !!user }),
    setIsLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
    setGitHubConnected: (githubConnected) => set({ githubConnected }),
    setGitHubUsername: (githubUsername) => set({ githubUsername }),
    logout: () => {
        set(initialState);
        if (typeof BroadcastChannel !== 'undefined') {
            const channel = new BroadcastChannel(SESSION_CHANNEL_NAME);
            channel.postMessage('invalidated');
            channel.close();
        }
        try {
            window.localStorage.setItem(SESSION_INVALIDATION_KEY, String(Date.now()));
        }
        catch {
            // BroadcastChannel still synchronizes tabs when storage is unavailable.
        }
    },
    reset: () => set(initialState),
}));

if (typeof window !== 'undefined') {
    if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(SESSION_CHANNEL_NAME);
        channel.onmessage = (event) => {
            if (event.data === 'invalidated') useAppStore.setState(initialState);
        };
    }
    window.addEventListener('storage', (event) => {
        if (event.key === SESSION_INVALIDATION_KEY) useAppStore.setState(initialState);
    });
}
