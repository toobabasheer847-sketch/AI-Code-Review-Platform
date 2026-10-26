import type { GitHubService, PullRequestFinding, ReviewSourceFile } from './github.service'

export interface CompletedPullRequestReview {
  id: string
  userId: string
  repository: { name: string }
  source?: string
  pullRequestNumber?: number | null
  headSha?: string | null
  changedLines?: unknown
  findings?: PullRequestFinding[]
}

export interface PullRequestReviewPublisherDependencies {
  github: Pick<GitHubService, 'publishPullRequestFindings'>
  setDeliveryStatus(
    reviewId: string,
    headSha: string,
    status: string,
    errorMessage?: string
  ): Promise<void>
}

function parseChangedLines(value: unknown): Record<string, number[]> {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored pull request changed-line metadata is invalid')
  }

  const changedLines: Record<string, number[]> = {}
  for (const [path, lines] of Object.entries(value)) {
    if (
      !Array.isArray(lines) ||
      !lines.every((line) => Number.isSafeInteger(line) && line > 0)
    ) {
      throw new Error('Stored pull request changed-line metadata is invalid')
    }
    changedLines[path] = lines
  }
  return changedLines
}

function getChangedLines(files: ReviewSourceFile[]): Record<string, number[]> {
  return Object.fromEntries(
    files
      .filter(
        (file): file is ReviewSourceFile & { changedLines: number[] } =>
          file.changedLines !== undefined
      )
      .map((file) => [file.path, file.changedLines])
  )
}

export async function publishCompletedPullRequestReview(
  review: CompletedPullRequestReview,
  dependencies: PullRequestReviewPublisherDependencies,
  files?: ReviewSourceFile[]
): Promise<void> {
  if (
    review.source !== 'PULL_REQUEST' ||
    !review.pullRequestNumber ||
    !review.headSha
  ) {
    return
  }

  const changedLines =
    files === undefined ? parseChangedLines(review.changedLines) : getChangedLines(files)

  let result: Awaited<
    ReturnType<PullRequestReviewPublisherDependencies['github']['publishPullRequestFindings']>
  >
  try {
    result = await dependencies.github.publishPullRequestFindings(
      review.userId,
      review.repository.name,
      review.pullRequestNumber,
      review.headSha,
      review.id,
      review.findings ?? [],
      changedLines
    )
  } catch (error) {
    await dependencies.setDeliveryStatus(
      review.id,
      review.headSha,
      'publish-failed',
      'GitHub pull request review publishing failed'
    )
    throw error
  }

  const status =
    result === 'stale'
      ? 'stale'
      : result === 'no-inline-findings'
        ? 'completed-no-inline-findings'
        : 'completed'
  await dependencies.setDeliveryStatus(review.id, review.headSha, status)
}
