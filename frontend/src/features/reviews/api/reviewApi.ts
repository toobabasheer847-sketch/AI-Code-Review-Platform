import { axiosInstance } from '@/lib/axios'

export interface ReviewSummary {
  id: string
  repository: string
  score: number | null
  issues: number
  status: 'pending' | 'running' | 'completed' | 'failed' | string
  source?: 'MANUAL' | 'PULL_REQUEST'
  pullRequestNumber?: number | null
  createdAt: string
}

export interface ReviewChatMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  createdAt: string
}

export interface ReviewChat {
  id: string
  title: string
  messages: ReviewChatMessage[]
}

export interface ReviewDetail {
  id: string
  repository: { name: string; url: string }
  title?: string
  description?: string
  fileContent?: string
  findings: Array<{ file: string; line: number; message: string; severity: string; suggestions: string[] }>
  analytics?: { totalIssues?: number; qualityScore?: number }
  chat?: ReviewChat | null
  status: 'pending' | 'running' | 'completed' | 'failed' | string
  branch: string
  errorMessage?: string | null
  source?: 'MANUAL' | 'PULL_REQUEST'
  pullRequestNumber?: number | null
  pullRequestUrl?: string | null
  pullRequestStatus?: string | null
  createdAt: string
}

export const reviewApi = {
  list: async (): Promise<ReviewSummary[]> => {
    const res = await axiosInstance.get<ReviewSummary[]>('/reviews')
    return res.data
  },

  get: async (id: string): Promise<ReviewDetail> => {
    const res = await axiosInstance.get<ReviewDetail>(`/reviews/${id}`)
    return res.data
  },
  start: async (repository: string, branch = 'main'): Promise<{ reviewId: string }> => {
    const res = await axiosInstance.post<{ reviewId: string }>('/reviews/start', { repository, branch })
    return res.data
  },
}
