import { axiosInstance } from '@/lib/axios'

export interface ReviewSummary {
  id: string
  repository: string
  score: number | null
  issues: number
  createdAt: string
}

export interface ReviewDetail {
  id: string
  repository: { name: string; url: string }
  title?: string
  description?: string
  fileContent?: string
  findings: Array<{ file: string; line: number; message: string; severity: string; suggestions: string[] }>
  analytics?: { totalIssues?: number; qualityScore?: number }
  chat?: any
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
