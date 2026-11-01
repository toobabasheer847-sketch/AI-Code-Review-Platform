export interface User {
  id: string
  email: string
  fullName: string
  avatar?: string
  createdAt: string
  updatedAt: string
}

export interface AuthResponse {
  user: User
}

export interface AuthState {
  user: User | null
  isLoading: boolean
  error: string | null
}
