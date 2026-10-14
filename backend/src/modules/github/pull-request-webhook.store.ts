import { Prisma } from '@prisma/client'
import { prisma } from '@/config/database'
import { releaseReviewQuota, reserveReviewQuota } from '@/modules/billing/review-quota'
import type {
  AuthorizedRepository,
  PullRequestDeliveryInput,
  PullRequestReviewReservation,
  PullRequestWebhookStore,
} from './pull-request-webhook'
import type { PullRequestReviewTarget } from './github.service'

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export const pullRequestWebhookStore: PullRequestWebhookStore = {
  async claimDelivery(input: PullRequestDeliveryInput): Promise<boolean> {
    try {
      await prisma.gitHubWebhookDelivery.create({
        data: {
          id: input.deliveryId,
          event: input.event,
          action: input.action,
          repositoryFullName: input.repositoryFullName,
          pullRequestNumber: input.pullRequestNumber,
          headSha: input.headSha,
          status: 'processing',
        },
      })
      return true
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const reclaimed = await prisma.gitHubWebhookDelivery.updateMany({
        where: { id: input.deliveryId, status: { in: ['failed', 'queue-failed'] } },
        data: { status: 'processing', errorMessage: null },
      })
      return reclaimed.count === 1
    }
  },

  async findAuthorizedRepositories(repositoryUrl: string): Promise<AuthorizedRepository[]> {
    return prisma.repository.findMany({
      where: { url: { equals: repositoryUrl, mode: 'insensitive' } },
      select: { id: true, userId: true, name: true, url: true },
      take: 10,
    })
  },

  async createOrGetReview(
    deliveryId: string,
    repository: AuthorizedRepository,
    target: PullRequestReviewTarget
  ): Promise<PullRequestReviewReservation> {
    const where = {
      repositoryId_pullRequestNumber_headSha: {
        repositoryId: repository.id,
        pullRequestNumber: target.number,
        headSha: target.headSha,
      },
    }

    try {
      return await prisma.$transaction(async (transaction) => {
        const existing = await transaction.codeReview.findUnique({
          where,
          select: { id: true, status: true, errorMessage: true },
        })
        if (existing) {
          if (existing.status === 'failed' && existing.errorMessage?.startsWith('Unable to queue pull request review:')) {
            await reserveReviewQuota(transaction, repository.userId)
            await transaction.codeReview.update({
              where: { id: existing.id },
              data: { status: 'pending', errorMessage: null },
            })
            await transaction.gitHubWebhookDelivery.update({
              where: { id: deliveryId },
              data: { reviewId: existing.id, status: 'processing', errorMessage: null },
            })
            return { reviewId: existing.id, status: 'pending', shouldQueue: true }
          }

          await transaction.gitHubWebhookDelivery.update({
            where: { id: deliveryId },
            data: { reviewId: existing.id },
          })
          return {
            reviewId: existing.id,
            status: existing.status,
            shouldQueue: existing.status === 'pending' || existing.status === 'running',
          }
        }

        await reserveReviewQuota(transaction, repository.userId)
        const review = await transaction.codeReview.create({
          data: {
            userId: repository.userId,
            repositoryId: repository.id,
            title: `Pull request #${target.number}: ${target.fullName}`,
            description: `Automated review for pull request #${target.number}.`,
            fileContent: '',
            branch: target.headBranch,
            source: 'PULL_REQUEST',
            pullRequestNumber: target.number,
            pullRequestUrl: target.htmlUrl,
            headSha: target.headSha,
            status: 'pending',
          },
          select: { id: true, status: true },
        })
        await transaction.gitHubWebhookDelivery.update({
          where: { id: deliveryId },
          data: { reviewId: review.id, status: 'processing' },
        })
        return { reviewId: review.id, status: review.status, shouldQueue: true }
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const existing = await prisma.codeReview.findUnique({
        where,
        select: { id: true, status: true },
      })
      if (!existing) throw error
      await prisma.gitHubWebhookDelivery.update({
        where: { id: deliveryId },
        data: { reviewId: existing.id },
      })
      return {
        reviewId: existing.id,
        status: existing.status,
        shouldQueue: existing.status === 'pending' || existing.status === 'running',
      }
    }
  },

  async setDeliveryStatus(
    deliveryId: string,
    status: string,
    errorMessage?: string
  ): Promise<void> {
    await prisma.gitHubWebhookDelivery.update({
      where: { id: deliveryId },
      data: { status, errorMessage: errorMessage ?? null },
    })
  },

  async failQueuedReview(
    deliveryId: string,
    reviewId: string,
    message: string
  ): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.codeReview.updateMany({
        where: { id: reviewId, status: 'pending' },
        data: {
          status: 'failed',
          errorMessage: `Unable to queue pull request review: ${message}`.slice(0, 500),
        },
      })
      if (updated.count > 0) {
        const review = await transaction.codeReview.findUnique({
          where: { id: reviewId },
          select: { userId: true, createdAt: true },
        })
        if (review) {
          await releaseReviewQuota(transaction, review.userId, review.createdAt)
        }
      }
      await transaction.gitHubWebhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'queue-failed',
          errorMessage: message.slice(0, 500),
          reviewId,
        },
      })
    })
  },
}
