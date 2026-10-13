export interface JWTPayload {
  userId: string
  email: string
  tokenVersion?: number
}

export interface User {
  id: string
  email: string
  fullName: string
  passwordHash: string
  githubId?: string
  avatar?: string
  createdAt: Date
  updatedAt: Date
}

export interface Repository {
  id: string
  userId: string
  name: string
  url: string
  language?: string
  description?: string
  createdAt: Date
  updatedAt: Date
}

export interface CodeReview {
  id: string
  userId: string
  repositoryId: string
  title: string
  description?: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed'
  findings: Finding[]
  createdAt: Date
  updatedAt: Date
}

export interface Finding {
  id: string
  reviewId: string
  file: string
  line: number
  message: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  suggestions?: string[]
}
