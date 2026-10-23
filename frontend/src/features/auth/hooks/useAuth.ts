/**
 * Auth Hooks
 * React Query hooks for authentication operations
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { isAxiosError } from 'axios'

import { useAppStore } from '@/app/store/useAppStore'

import {
  authApi,
  type AuthResponse,
  type LoginPayload,
  type RegisterPayload,
  type UserResponse,
} from '../api/authApi'

function getAuthErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<Record<string, unknown>>(error)) {
    const responseData = error.response?.data
    const rawMessage =
      typeof responseData === 'string'
        ? responseData
        : responseData && typeof responseData === 'object'
          ? 'error' in responseData && typeof responseData.error === 'string'
            ? responseData.error
            : 'message' in responseData && typeof responseData.message === 'string'
              ? responseData.message
              : undefined
          : undefined

    if (typeof rawMessage === 'string') {
      const apiMessage = rawMessage.trim()

      if (error.response?.status === 409 && apiMessage.toLowerCase() === 'email already registered') {
        return 'An account with this email already exists. Please sign in or use a different email.'
      }

      return apiMessage || fallback
    }
  }

  return error instanceof Error ? error.message || fallback : fallback
}

/**
 * Hook for user registration
 */
export const useRegister = (): UseMutationResult<AuthResponse, Error, RegisterPayload> => {
  const setUser = useAppStore((state) => state.setUser)
  const setToken = useAppStore((state) => state.setToken)
  const setIsLoading = useAppStore((state) => state.setIsLoading)
  const setError = useAppStore((state) => state.setError)

  return useMutation({
    mutationFn: async (payload: RegisterPayload) => {
      setIsLoading(true)
      try {
        return await authApi.register(payload)
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
      setError(getAuthErrorMessage(error, 'Registration failed. Please try again.'))
    },
  })
}

/**
 * Hook for user login
 */
export const useLogin = (): UseMutationResult<AuthResponse, Error, LoginPayload> => {
  const setUser = useAppStore((state) => state.setUser)
  const setToken = useAppStore((state) => state.setToken)
  const setIsLoading = useAppStore((state) => state.setIsLoading)
  const setError = useAppStore((state) => state.setError)

  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      setIsLoading(true)
      try {
        return await authApi.login(payload)
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
      setError(getAuthErrorMessage(error, 'Login failed. Please try again.'))
    },
  })
}

/**
 * Hook for fetching current user (protected)
 */
export const useMe = (): UseQueryResult<UserResponse['user'], Error> => {
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
export const useLogout = (): UseMutationResult<void, Error, void> => {
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
