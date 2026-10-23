import { Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
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
import { persistReviewAnalysis } from '@/modules/code-review/review.persistence'
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
        findings: {
          select: {
            file: true,
            line: true,
            endLine: true,
            severity: true,
            category: true,
            title: true,
            message: true,
            evidence: true,
            suggestions: true,
          },
        },
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
    await prisma.$transaction(async (transaction) => {
      await persistReviewAnalysis(
        {
          async deleteFindings(reviewId) {
            await transaction.finding.deleteMany({ where: { reviewId } })
          },
          async createFindings(findings) {
            await transaction.finding.createMany({ data: findings })
          },
          async upsertAnalytics(userId, reviewId, analytics) {
            await transaction.reviewAnalytics.upsert({
              where: { reviewId },
              create: { userId, reviewId, ...analytics },
              update: analytics,
            })
          },
          async completeReview(
            reviewId,
            summary,
            fileContent,
            changedLines,
            reviewLimitations
          ) {
            await transaction.codeReview.update({
              where: { id: reviewId },
              data: {
                status: 'completed',
                errorMessage: null,
                description: summary,
                fileContent,
                changedLines: changedLines ?? Prisma.JsonNull,
                reviewLimitations,
              },
            })
          },
        },
        review,
        analysis,
        files
      )
    })
  },

  async markFailed(reviewId, message): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      await transaction.codeReview.update({
        where: { id: reviewId },
        data: { status: 'failed', errorMessage: message },
      })
      await transaction.gitHubWebhookDelivery.updateMany({
        where: { reviewId },
        data: { status: 'failed', errorMessage: message },
      })
    })
  },
}

const worker = new Worker<ReviewJobData>(
  'code-review',
  async (job) => {
    await processReview(job.data.reviewId, {
      store,
      fetchFiles: (userId, repository, branch, review) =>
        review?.source === 'PULL_REQUEST' &&
        review.pullRequestNumber &&
        review.headSha
          ? githubService.fetchPullRequestFiles(
              userId,
              repository,
              review.pullRequestNumber,
              review.headSha
            )
          : githubService.fetchReviewFiles(userId, repository, branch),
      analyze: analyzeCode,
      async notify(review, analysis): Promise<void> {
        if (review.source === 'PULL_REQUEST') {
          await prisma.gitHubWebhookDelivery.updateMany({
            where: { reviewId: review.id },
            data: { status: 'completed-not-published', errorMessage: null },
          })
        }

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

worker.on('failed', (job) => {
  logger.error({ reviewId: job?.data.reviewId }, 'Code review job failed')
})
worker.on('error', () => {
  logger.error('Code review worker error')
})

export async function startReviewWorker(): Promise<void> {
  void worker.run().catch(() => {
    logger.error('Code review worker stopped unexpectedly')
  })
}

export async function stopReviewWorker(): Promise<void> {
  await worker.close()
  await connection.quit()
}
