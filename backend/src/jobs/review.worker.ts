import { Worker } from 'bullmq'
import IORedis from 'ioredis'
import { env } from '@/config/env'
import { prisma } from '@/config/database'
import { emailQueue } from './email.queue'
import { analyzeCode } from '@/modules/code-review/analyzer'
import {
  processReview,
  type ReviewJobRecord,
  type ReviewJobStore,
} from '@/modules/code-review/review.pipeline'
import type { ReviewAnalysis } from '@/modules/code-review/analyzer'
import type { ReviewSourceFile } from '@/modules/github/github.service'
import { GitHubService } from '@/modules/github/github.service'
import type { ReviewJobData } from './review.queue'
import logger from '@/utils/logger'

const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
})
const githubService = new GitHubService()

const store: ReviewJobStore = {
  async findForProcessing(reviewId): Promise<ReviewJobRecord | null> {
    const review = await prisma.codeReview.findUnique({
      where: { id: reviewId },
      include: {
        repository: { select: { name: true } },
        user: { select: { email: true } },
        analytics: { select: { qualityScore: true, totalIssues: true } },
      },
    })
    return review
  },

  async markRunning(reviewId): Promise<void> {
    await prisma.codeReview.update({
      where: { id: reviewId },
      data: { status: 'running', errorMessage: null },
    })
  },

  async complete(
    review: ReviewJobRecord,
    analysis: ReviewAnalysis,
    files: ReviewSourceFile[]
  ): Promise<void> {
    const fileContent = files.map((file) => `--- ${file.path} ---\n${file.content}`).join('\n\n')
    await prisma.$transaction(async (transaction) => {
      await transaction.finding.deleteMany({ where: { reviewId: review.id } })
      if (analysis.findings.length > 0) {
        await transaction.finding.createMany({
          data: analysis.findings.map((finding) => ({
            reviewId: review.id,
            file: finding.file,
            line: finding.line,
            severity: finding.severity,
            category: finding.category,
            message: finding.message,
            suggestions: finding.suggestions,
          })),
        })
      }
      await transaction.reviewAnalytics.upsert({
        where: { reviewId: review.id },
        create: {
          userId: review.userId,
          reviewId: review.id,
          ...analysis.analytics,
        },
        update: analysis.analytics,
      })
      await transaction.codeReview.update({
        where: { id: review.id },
        data: {
          status: 'completed',
          errorMessage: null,
          description: analysis.summary,
          fileContent,
        },
      })
    })
  },

  async markFailed(reviewId, message): Promise<void> {
    await prisma.codeReview.update({
      where: { id: reviewId },
      data: { status: 'failed', errorMessage: message },
    })
  },
}

const worker = new Worker<ReviewJobData>(
  'code-review',
  async (job) => {
    await processReview(job.data.reviewId, {
      store,
      fetchFiles: (userId, repository, branch) =>
        githubService.fetchReviewFiles(userId, repository, branch),
      analyze: analyzeCode,
      async notify(review, analysis): Promise<void> {
        await emailQueue.add(
          'send-review-complete',
          {
            type: 'review:complete',
            payload: {
              to: review.user.email,
              repository: review.repository.name,
              score:
                analysis?.analytics.qualityScore ??
                review.analytics?.qualityScore ??
                0,
              issues:
                analysis?.analytics.totalIssues ??
                review.analytics?.totalIssues ??
                0,
              summary:
                analysis?.summary ??
                review.description ??
                'Your code review is ready.',
              reviewId: review.id,
              reviewUrl: `${env.FRONTEND_URL}/reviews/${review.id}`,
            },
          },
          {
            jobId: `review-complete-${review.id}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
          }
        )
      },
    })
  },
  { connection, autorun: false }
)

worker.on('failed', (job, error) => {
  logger.error({ reviewId: job?.data.reviewId, error }, 'Code review job failed')
})
worker.on('error', (error) => {
  logger.error({ error }, 'Code review worker error')
})

export async function startReviewWorker(): Promise<void> {
  void worker.run().catch((error: unknown) => {
    logger.error({ error }, 'Code review worker stopped unexpectedly')
  })
}

export async function stopReviewWorker(): Promise<void> {
  await worker.close()
  await connection.quit()
}
