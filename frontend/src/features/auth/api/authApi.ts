/**
 * Auth API Service
 * Handles all authentication-related API calls
 */

import { axiosInstance } from '@/lib/axios'

export interface RegisterPayload {
  email: string
  fullName: string
  password: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface AuthResponse {
  token: string
  user: {
    id: string
    email: string
    fullName: string
    avatar: string | null
    isVerified: boolean
    githubConnected: boolean
    githubUsername: string | null
    createdAt: string
    updatedAt: string
  }
}

export interface UserResponse {
  user: {
    id: string
    email: string
    fullName: string
    avatar: string | null
    isVerified: boolean
    githubConnected: boolean
    githubUsername: string | null
    createdAt: string
    updatedAt: string
  }
}

export const authApi = {
  register: async (payload: RegisterPayload): Promise<AuthResponse> => {
    const response = await axiosInstance.post<AuthResponse>('/auth/register', payload)
    return response.data
  },

  login: async (payload: LoginPayload): Promise<AuthResponse> => {
    const response = await axiosInstance.post<AuthResponse>('/auth/login', payload)
    return response.data
  },

  getCurrentUser: async (): Promise<UserResponse> => {
    const response = await axiosInstance.get<UserResponse>('/auth/me')
    return response.data
  },

  logout: async (): Promise<void> => {
    await axiosInstance.post('/auth/logout')
  },

  verifyEmail: async (token: string): Promise<{ message: string }> => {
    const response = await axiosInstance.post<{ message: string }>('/auth/verify-email', { token })
    return response.data
  },

  resendVerificationEmail: async (): Promise<{ message: string }> => {
    const response = await axiosInstance.post<{ message: string }>('/auth/verification-email')
    return response.data
  },

  requestPasswordReset: async (email: string): Promise<{ message: string }> => {
    const response = await axiosInstance.post<{ message: string }>('/auth/password-reset/request', { email })
    return response.data
  },

  resetPassword: async (token: string, password: string): Promise<{ message: string }> => {
    const response = await axiosInstance.post<{ message: string }>('/auth/password-reset/confirm', {
      token,
      password,
    })
    return response.data
  },

  deleteAccount: async (
    password: string,
    confirmation: string
  ): Promise<{ message: string; providerRevoked: boolean }> => {
    const response = await axiosInstance.delete<{ message: string; providerRevoked: boolean }>(
      '/auth/account',
      { data: { password, confirmation } }
    )
    return response.data
  },
}
