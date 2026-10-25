import { QueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
      retry: (failureCount, error) => {
        if (isAxiosError(error)) {
          const status = error.response?.status
          if (status !== undefined && status >= 400 && status < 500) {
            return false
          }
        }

        return failureCount < 1
      },
    },
    mutations: {
      retry: (failureCount, error) => {
        if (isAxiosError(error)) {
          const status = error.response?.status
          if (
            status === 400 ||
            status === 401 ||
            status === 403 ||
            status === 404 ||
            status === 409 ||
            status === 408 ||
            status === 429 ||
            status === 503
          ) {
            return false
          }
        }

        return failureCount < 1
      },
    },
  },
})
