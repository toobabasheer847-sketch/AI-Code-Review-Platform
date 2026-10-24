import type { ReviewAnalysis } from './analyzer'
import type { ReviewSourceFile } from '@/modules/github/github.service'

type FindingPersistenceInput = ReviewAnalysis['findings'][number] & {
  reviewId: string
  verificationRecords: {
    create: {
      requestKey: string
      status: 'AI_REPORTED'
      method: 'AI_REVIEW'
      resultSummary: string
      sourceRevision: string
      startedAt: Date
      completedAt: Date
    }
  }
}

export interface ReviewPersistenceOperations {
  deleteFindings(reviewId: string): Promise<void>
  createFindings(findings: FindingPersistenceInput[], sourceRevision: string): Promise<void>
  upsertAnalytics(
    userId: string,
    reviewId: string,
    analytics: ReviewAnalysis['analytics']
  ): Promise<void>
  completeReview(
    reviewId: string,
    summary: string,
    fileContent: string,
    sourceRevision: string,
    changedLines: Record<string, number[]> | null,
    limitations: string[]
  ): Promise<void>
}

export function resolveReviewSourceRevision(files: ReviewSourceFile[]): string {
  const revisions = new Set(files.map((file) => file.sourceRevision))
  if (revisions.size !== 1 || revisions.has(undefined) || revisions.has('')) {
    throw new Error('Review source files do not share a valid source revision')
  }
  const sourceRevision = files[0]?.sourceRevision
  if (!sourceRevision || !/^[\da-f]{40,64}$/i.test(sourceRevision)) {
    throw new Error('Review source revision is invalid')
  }
  return sourceRevision
}

export async function persistReviewAnalysis(
  operations: ReviewPersistenceOperations,
  review: { id: string; userId: string },
  analysis: ReviewAnalysis,
  files: ReviewSourceFile[]
): Promise<void> {
  const sourceRevision = resolveReviewSourceRevision(files)
  const fileContent = files.map((file) => `--- ${file.path} ---\n${file.content}`).join('\n\n')

  await operations.deleteFindings(review.id)
  if (analysis.findings.length > 0) {
    const timestamp = new Date()
    await operations.createFindings(
      analysis.findings.map((finding) => ({
        ...finding,
        reviewId: review.id,
        verificationRecords: {
          create: {
            requestKey: `ai-review:${review.id}`,
            status: 'AI_REPORTED',
            method: 'AI_REVIEW',
            resultSummary:
              'AI-reported finding. Its cited evidence matched the retrieved source; the issue itself was not independently verified.',
            sourceRevision,
            startedAt: timestamp,
            completedAt: timestamp,
          },
        },
      })),
      sourceRevision
    )
  }
  await operations.upsertAnalytics(review.userId, review.id, analysis.analytics)
  const changedFiles = Object.fromEntries(
    files
      .filter((file): file is typeof file & { changedLines: number[] } => file.changedLines !== undefined)
      .map((file) => [file.path, file.changedLines])
  )
  await operations.completeReview(
    review.id,
    analysis.summary,
    fileContent,
    sourceRevision,
    Object.keys(changedFiles).length > 0 ? changedFiles : null,
    analysis.limitations
  )
}
