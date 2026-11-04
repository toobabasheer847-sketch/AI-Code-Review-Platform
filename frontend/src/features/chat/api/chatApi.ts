import { axiosInstance } from '@/lib/axios'

import type { RepositoryQAResult } from '../types'

export interface ReviewChatResponse {
  answer: string
  conversationId: string
}

export const chatApi = {
  askRepository: async (input: {
    repository: string
    branch: string
    question: string
  }): Promise<RepositoryQAResult> => {
    const response = await axiosInstance.post<RepositoryQAResult>(
      '/chat/repository-message',
      input
    )
    return response.data
  },

  askReview: async (input: {
    reviewId: string
    message: string
  }): Promise<ReviewChatResponse> => {
    const response = await axiosInstance.post<ReviewChatResponse>('/chat/message', input)
    return response.data
  },
}
