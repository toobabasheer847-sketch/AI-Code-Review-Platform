import { axiosInstance } from '@/lib/axios'

import type { FeedbackCategory, FeedbackDraft } from '../beta'

export interface BetaGuide {
  limitations: string[]
  dismissed: boolean
  steps: Array<{ id: string; label: string; href: string; complete: boolean }>
}

export interface ProductFeedback {
  id: string
  userId: string
  category: FeedbackCategory
  status: 'OPEN' | 'TRIAGED' | 'PLANNED' | 'CLOSED'
  subject: string
  body: string
  rating: number | null
  reviewId: string | null
  createdAt: string
  updatedAt: string
}

export interface BetaOverview {
  users: Array<{
    id: string
    email: string
    fullName: string
    betaStatus: 'ACTIVE' | 'PENDING' | 'REVOKED'
    createdAt: string
  }>
  feedback: ProductFeedback[]
  usage: Record<string, number>
}

export const betaApi = {
  guide: async (): Promise<BetaGuide> => {
    const response = await axiosInstance.get<BetaGuide>('/beta/guide')
    return response.data
  },
  dismissOnboarding: async (): Promise<void> => {
    await axiosInstance.post('/beta/onboarding/dismiss')
  },
  listFeedback: async (): Promise<ProductFeedback[]> => {
    const response = await axiosInstance.get<{ feedback: ProductFeedback[] }>('/beta/feedback')
    return response.data.feedback
  },
  submitFeedback: async (draft: FeedbackDraft): Promise<ProductFeedback> => {
    const response = await axiosInstance.post<{ feedback: ProductFeedback }>('/beta/feedback', {
      category: draft.category,
      subject: draft.subject.trim(),
      body: draft.body.trim(),
      rating: draft.category === 'REVIEW_QUALITY' ? draft.rating : undefined,
      reviewId: draft.reviewId?.trim() || undefined,
    })
    return response.data.feedback
  },
  overview: async (): Promise<BetaOverview> => {
    const response = await axiosInstance.get<BetaOverview>('/beta/admin/overview')
    return response.data
  },
  updateStatus: async (id: string, status: ProductFeedback['status']): Promise<void> => {
    await axiosInstance.patch(`/beta/admin/feedback/${id}`, { status })
  },
}
