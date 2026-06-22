/**
 * Auth Hooks
 * React Query hooks for authentication operations
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi, type RegisterPayload, type LoginPayload, type AuthResponse } from '../api/authApi'
import { useAppStore } from '@/app/store/useAppStore'

/**
 * Hook for user registration
 */
export const useRegister = () => {
  const setUser = useAppStore((state) => state.setUser)
  const setToken = useAppStore((state) => state.setToken)
  const setIsLoading = useAppStore((state) => state.setIsLoading)
  const setError = useAppStore((state) => state.setError)

  return useMutation({
    mutationFn: async (payload: RegisterPayload) => {
      setIsLoading(true)
      try {
        const response = await authApi.register(payload)
        return response
      } catch (error) {
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    onSuccess: (data: AuthResponse) => {
      setToken(data.token)
      setUser(data.user)
      setError(null)
    },
    onError: (error: Error) => {
      setError(error.message || 'Registration failed')
    },
  })
}

/**
 * Hook for user login
 */
export const useLogin = () => {
  const setUser = useAppStore((state) => state.setUser)
  const setToken = useAppStore((state) => state.setToken)
  const setIsLoading = useAppStore((state) => state.setIsLoading)
  const setError = useAppStore((state) => state.setError)

  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      setIsLoading(true)
      try {
        const response = await authApi.login(payload)
        return response
      } catch (error) {
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    onSuccess: (data: AuthResponse) => {
      setToken(data.token)
      setUser(data.user)
      setError(null)
    },
    onError: (error: Error) => {
      setError(error.message || 'Login failed')
    },
  })
}

/**
 * Hook for fetching current user (protected)
 */
export const useMe = () => {
  const token = useAppStore((state) => state.token)
  const setUser = useAppStore((state) => state.setUser)

  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const response = await authApi.getCurrentUser()
      setUser(response.user)
      return response.user
    },
    enabled: !!token,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  })
}

/**
 * Hook for logout
 */
export const useLogout = () => {
  const queryClient = useQueryClient()
  const logout = useAppStore((state) => state.logout)

  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      logout()
      queryClient.clear()
    },
  })
}
