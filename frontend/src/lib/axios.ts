import axios, { AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios'

import { useAppStore } from '@/app/store/useAppStore'
import type { CsrfResponse } from '@/features/auth/api/authApi'
import { getActiveWorkspaceId } from '@/features/workspaces/store/workspace-selection'
import { reportFrontendError } from '@/lib/errorMonitoring'
import { queryClient } from '@/lib/queryClient'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
const CSRF_REFRESH_MARGIN_MS = 30_000
const PUBLIC_AUTH_ENDPOINTS = new Set([
  '/auth/csrf',
  '/auth/login',
  '/auth/register',
  '/auth/verify-email',
  '/auth/verification-email/request',
  '/auth/password-reset/request',
  '/auth/password-reset/confirm',
])

let csrfToken: string | null = null
let csrfExpiresAt = 0
let csrfRequest: Promise<string> | null = null

export const axiosInstance: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

function requestPath(config: InternalAxiosRequestConfig): string {
  return (config.url ?? '').split('?')[0].replace(/\/+$/, '')
}

function isUnsafeMethod(config: InternalAxiosRequestConfig): boolean {
  return !['get', 'head', 'options'].includes((config.method ?? 'get').toLowerCase())
}

function getCsrfToken(): Promise<string> {
  if (csrfToken && csrfExpiresAt - Date.now() > CSRF_REFRESH_MARGIN_MS) {
    return Promise.resolve(csrfToken)
  }
  if (csrfRequest) return csrfRequest

  csrfRequest = axiosInstance
    .get<CsrfResponse>('/auth/csrf')
    .then(({ data }) => {
      if (!data.csrfToken || !Number.isSafeInteger(data.expiresInMs) || data.expiresInMs <= 0) {
        throw new Error('The server returned an invalid CSRF token response')
      }
      csrfToken = data.csrfToken
      csrfExpiresAt = Date.now() + data.expiresInMs
      return csrfToken
    })
    .finally(() => {
      csrfRequest = null
    })
  return csrfRequest
}

function clearCsrfToken(): void {
  csrfToken = null
  csrfExpiresAt = 0
  csrfRequest = null
}

axiosInstance.interceptors.request.use(
  async (config) => {
    const workspaceId = getActiveWorkspaceId()
    if (workspaceId && !PUBLIC_AUTH_ENDPOINTS.has(requestPath(config))) {
      config.headers['X-Workspace-Id'] = workspaceId
    }
    if (isUnsafeMethod(config) && requestPath(config) !== '/auth/csrf') {
      config.headers['X-CSRF-Token'] = await getCsrfToken()
    }
    return config
  },
  (error: unknown) => Promise.reject(error)
)

axiosInstance.interceptors.response.use(
  (response) => {
    if (
      response.config.url &&
      ['/auth/logout', '/auth/password-reset/confirm', '/auth/account'].includes(
        response.config.url.split('?')[0].replace(/\/+$/, '')
      )
    ) {
      clearCsrfToken()
    }
    return response
  },
  (error: AxiosError<{ code?: string }>) => {
    const config = error.config
    if (!error.response || error.response.status >= 500) {
      reportFrontendError(
        error,
        'api',
        error.response ? 'server' : 'network'
      )
    }
    if (error.response?.status === 403 && error.response.data?.code === 'CSRF_INVALID') {
      clearCsrfToken()
    }
    if (
      error.response?.status === 401 &&
      config &&
      !PUBLIC_AUTH_ENDPOINTS.has(requestPath(config))
    ) {
      clearCsrfToken()
      if (useAppStore.getState().isAuthenticated) {
        useAppStore.getState().logout()
        queryClient.clear()
      }
    }
    return Promise.reject(error)
  }
)

export default axiosInstance
