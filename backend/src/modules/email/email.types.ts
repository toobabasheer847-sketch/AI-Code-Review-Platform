export interface ReviewCompletePayload {
  to: string
  repository: string
  score: number | null
  issues: number
  summary: string
  reviewId: string
  reviewUrl?: string
}

export interface AutomationNotificationPayload {
  outboxId: string;
  to: string;
  subject: string;
  heading: string;
  details: string[];
  url: string;
}
