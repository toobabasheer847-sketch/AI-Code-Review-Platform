export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    LOGOUT: '/auth/logout',
    REFRESH: '/auth/refresh',
    GITHUB_CALLBACK: '/auth/github/callback',
  },
  USERS: {
    PROFILE: '/users/profile',
    UPDATE_PROFILE: '/users/profile',
  },
  REPOSITORIES: {
    LIST: '/repositories',
    GET: (id: string) => `/repositories/${id}`,
    CREATE: '/repositories',
    DELETE: (id: string) => `/repositories/${id}`,
  },
  REVIEWS: {
    LIST: '/reviews',
    GET: (id: string) => `/reviews/${id}`,
    CREATE: '/reviews',
    UPDATE: (id: string) => `/reviews/${id}`,
  },
  AI: {
    ANALYZE: '/ai/analyze',
    CHAT: '/ai/chat',
  },
}

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
}

export const TOAST_DURATION = 5000
export const API_TIMEOUT = 30000
