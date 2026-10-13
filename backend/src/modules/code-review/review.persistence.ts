import type { ReviewAnalysis } from './analyzer'
import type { ReviewSourceFile } from '@/modules/github/github.service'

type FindingPersistenceInput = ReviewAnalysis['findings'][number] & {
  reviewId: string
}

export interface ReviewPersistenceOperations {
  deleteFindings(reviewId: string): Promise<void>
  createFindings(findings: FindingPersistenceInput[]): Promise<void>
  upsertAnalytics(
    userId: string,
    reviewId: string,
    analytics: ReviewAnalysis['analytics']
  ): Promise<void>
  completeReview(reviewId: string, summary: string, fileContent: string): Promise<void>
}

export async function persistReviewAnalysis(
  operations: ReviewPersistenceOperations,
  review: { id: string; userId: string },
  analysis: ReviewAnalysis,
  files: ReviewSourceFile[]
): Promise<void> {
  const fileContent = files.map((file) => `--- ${file.path} ---\n${file.content}`).join('\n\n')

  await operations.deleteFindings(review.id)
  if (analysis.findings.length > 0) {
    await operations.createFindings(
      analysis.findings.map((finding) => ({ ...finding, reviewId: review.id }))
    )
  }
  await operations.upsertAnalytics(review.userId, review.id, analysis.analytics)
  await operations.completeReview(review.id, analysis.summary, fileContent)
}
