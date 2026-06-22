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
}
