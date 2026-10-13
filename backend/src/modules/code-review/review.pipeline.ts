import type { ReviewAnalysis } from './analyzer'
import type { ReviewSourceFile } from '@/modules/github/github.service'

export interface ReviewJobRecord {
  id: string
  userId: string
  branch: string
  status: string
  repository: { name: string }
  user: { email: string }
  source?: string
  pullRequestNumber?: number | null
  pullRequestUrl?: string | null
  headSha?: string | null
  changedLines?: unknown
  findings?: Array<{
    file: string
    line: number
    severity: string
    category: string
    title?: string | null
    message: string
    evidence?: string | null
    endLine?: number | null
    suggestions: string[]
  }>
  description?: string | null
  analytics?: { qualityScore: number; totalIssues: number } | null
}

export interface ReviewJobStore {
  findForProcessing(reviewId: string): Promise<ReviewJobRecord | null>
  markRunning(reviewId: string): Promise<void>
  complete(
    review: ReviewJobRecord,
    analysis: ReviewAnalysis,
    files: ReviewSourceFile[]
  ): Promise<void>
  markFailed(reviewId: string, message: string): Promise<void>
}

export interface ReviewPipelineDependencies {
  store: ReviewJobStore
  fetchFiles(
    userId: string,
    repository: string,
    branch: string,
    review?: ReviewJobRecord
  ): Promise<ReviewSourceFile[]>
  analyze(files: ReviewSourceFile[]): Promise<ReviewAnalysis>
  notify(review: ReviewJobRecord, analysis?: ReviewAnalysis): Promise<void>
}

export async function processReview(
  reviewId: string,
  dependencies: ReviewPipelineDependencies
): Promise<void> {
  const review = await dependencies.store.findForProcessing(reviewId)
  if (!review) {
    throw new Error(`Review ${reviewId} does not exist`)
  }

  if (review.status === 'completed') {
    await dependencies.notify(review)
    return
  }

  await dependencies.store.markRunning(reviewId)

  let analysis: ReviewAnalysis
  try {
    const files = await dependencies.fetchFiles(
      review.userId,
      review.repository.name,
      review.branch,
      review
    )
    analysis = await dependencies.analyze(files)
    await dependencies.store.complete(review, analysis, files)
  } catch {
    try {
      await dependencies.store.markFailed(
        reviewId,
        'Review processing failed. Provider and repository details were omitted.'
      )
    } catch {
      throw new Error('Review processing failed and its failure state could not be saved')
    }
    throw new Error('Review processing failed')
  }

  await dependencies.notify(review, analysis)
}
