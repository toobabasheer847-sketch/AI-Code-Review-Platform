import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import Cookies from 'js-cookie'

export interface User {
  id: string
  email: string
  fullName: string
  avatar: string | null
  isVerified: boolean
  githubConnected?: boolean
  githubUsername?: string | null
  createdAt: string
}

export interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  githubConnected: boolean
  githubUsername: string | null
  selectedPlan?: 'free' | 'pro' | null
}

export interface AppStore extends AuthState {
  setUser: (user: User | null) => void
  setToken: (token: string | null) => void
  setIsLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setGitHubConnected: (connected: boolean) => void
  setGitHubUsername: (username: string | null) => void
  setSelectedPlan: (plan: 'free' | 'pro' | null) => void
  logout: () => void
  reset: () => void
}

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  githubConnected: false,
  githubUsername: null,
  selectedPlan: null,
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      ...initialState,
      setSelectedPlan: (selectedPlan) => set({ selectedPlan }),
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setToken: (token) => {
        if (token) {
          Cookies.set('token', token, {
            expires: 7,
            secure: window.location.protocol === 'https:',
            sameSite: 'strict',
          })
        } else {
          Cookies.remove('token')
        }
        set({ token })
      },
      setIsLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setGitHubConnected: (githubConnected) => set({ githubConnected }),
      setGitHubUsername: (githubUsername) => set({ githubUsername }),
      logout: () => {
        Cookies.remove('token')
        set(initialState)
      },
      reset: () => set(initialState),
    }),
    {
      name: 'app-store',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        githubConnected: state.githubConnected,
        githubUsername: state.githubUsername,
        selectedPlan: state.selectedPlan,
      }),
    }
  )
)
