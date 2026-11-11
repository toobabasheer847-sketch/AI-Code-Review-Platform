export const reviewListLimit = 100

export interface ReviewListRow {
  id: string
  status: string
  source: string
  pullRequestNumber: number | null
  createdAt: Date
  repository: { name: string }
  analytics: { qualityScore: number | null } | null
  _count: { findings: number }
}

export function toReviewListItem(review: ReviewListRow) {
  return {
    id: review.id,
    repository: review.repository.name,
    score: review.analytics?.qualityScore ?? null,
    issues: review._count.findings,
    status: review.status,
    source: review.source,
    pullRequestNumber: review.pullRequestNumber,
    createdAt: review.createdAt,
  }
}
