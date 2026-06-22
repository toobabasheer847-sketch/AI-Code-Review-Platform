export interface ReviewCompletePayload {
  to: string
  repository: string
  score: number
  issues: number
  summary: string
  reviewId: string
  reviewUrl?: string
}
