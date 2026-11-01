import { create } from 'zustand'

export interface User {
  id: string
  email: string
  fullName: string
  avatar: string | null
  isVerified: boolean
  githubConnected: boolean
  githubUsername: string | null
  createdAt: string
}

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

export interface AuthStoreActions {
  setUser: (user: User | null) => void
  setIsLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  logout: () => void
  reset: () => void
}

export type AuthStore = AuthState & AuthStoreActions

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
}

export const useAuthStore = create<AuthStore>()((set) => ({
  ...initialState,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  logout: () => set(initialState),
  reset: () => set(initialState),
}))
