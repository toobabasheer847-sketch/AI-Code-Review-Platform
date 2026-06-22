export interface UserResponse {
  id: string
  email: string
  fullName: string
  avatar: string | null
  isVerified: boolean
  githubConnected: boolean
  githubUsername: string | null
  createdAt: Date
  updatedAt: Date
}

export interface AuthResponse {
  token: string
  user: UserResponse
}
