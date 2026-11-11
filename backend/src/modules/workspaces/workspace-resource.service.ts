import { prisma } from '@/config/database'
import { reviewQueue } from '@/jobs/review.queue'
import { GitHubService } from '@/modules/github/github.service'
import { releaseReviewQuota, reserveReviewQuota } from '@/modules/billing/review-quota'
import {
  releaseWorkspaceReviewQuota,
  reserveWorkspaceReviewQuota,
} from '@/modules/billing/workspace-review-quota'
import { WorkspaceServiceError } from './workspace.service'
import { workspaceReviewWhere } from './workspace.domain'
import { reviewListLimit, toReviewListItem } from '@/modules/code-review/review-list'
import type { FindingStatus } from '@prisma/client'
import { FindingLifecycleService } from '@/modules/code-review/finding-lifecycle.service'

export class WorkspaceResourceService {
  constructor(
    private readonly github: Pick<GitHubService, 'validateReviewTarget'> = new GitHubService(),
    private readonly findingLifecycle: FindingLifecycleService = new FindingLifecycleService()
  ) {}

  async listRepositories(workspaceId: string) {
    return prisma.repository.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        url: true,
        language: true,
        description: true,
        isPrivate: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
      take: 200,
    })
  }

  async getBilling(workspaceId: string, now = new Date()) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    })
    if (!workspace) throw new WorkspaceServiceError(404, 'Workspace not found')
    const month = now.getUTCMonth() + 1
    const year = now.getUTCFullYear()
    const [billing, usage] = await Promise.all([
      prisma.workspaceBillingAccount.findUnique({
        where: { organizationId: workspace.organizationId },
        select: {
          plan: true,
          status: true,
          priceId: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelledAt: true,
        },
      }),
      prisma.workspaceUsage.findUnique({
        where: {
          organizationId_month_year: {
            organizationId: workspace.organizationId,
            month,
            year,
          },
        },
        select: { reviewCount: true },
      }),
    ])
    return {
      billing: billing ?? { plan: 'FREE', status: 'ACTIVE' },
      usage: { month, year, reviewCount: usage?.reviewCount ?? 0 },
    }
  }

  async listReviews(workspaceId: string) {
    const reviews = await prisma.codeReview.findMany({
      where: workspaceReviewWhere(workspaceId),
      select: {
        id: true,
        status: true,
        source: true,
        pullRequestNumber: true,
        createdAt: true,
        repository: { select: { name: true } },
        analytics: { select: { qualityScore: true } },
        _count: { select: { findings: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: reviewListLimit,
    })
    return reviews.map(toReviewListItem)
  }

  async getReview(workspaceId: string, reviewId: string) {
    const review = await prisma.codeReview.findFirst({
      where: workspaceReviewWhere(workspaceId, reviewId),
      include: {
        repository: true,
        findings: {
          include: {
            feedback: {
              include: { user: { select: { fullName: true } } },
              orderBy: { createdAt: 'asc' },
            },
            fixProposals: { include: { attempts: { orderBy: { createdAt: 'desc' } } } },
            verificationRecords: { orderBy: { startedAt: 'asc' } },
          },
        },
        analytics: true,
      },
    })
    if (!review) throw new WorkspaceServiceError(404, 'Review not found')
    return review
  }

  async startReview(
    workspaceId: string,
    userId: string,
    repositoryName: string,
    branch: string
  ) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { isPersonal: true, organizationId: true },
    })
    if (!workspace) throw new WorkspaceServiceError(404, 'Workspace not found')
    const target = await this.github.validateReviewTarget(userId, repositoryName, branch)
    const review = await prisma.$transaction(async (transaction) => {
      if (workspace.isPersonal) {
        await reserveReviewQuota(transaction, userId)
      } else {
        await reserveWorkspaceReviewQuota(transaction, workspace.organizationId)
      }
      const repository = await transaction.repository.upsert({
        where: { workspaceId_url: { workspaceId, url: target.htmlUrl } },
        create: {
          workspaceId,
          userId,
          name: target.fullName,
          url: target.htmlUrl,
        },
        update: {},
      })
      return transaction.codeReview.create({
        data: {
          workspaceId,
          userId,
          repositoryId: repository.id,
          title: `Code review: ${target.fullName} (${branch})`,
          description: `Automated review for ${target.fullName} on branch ${branch}`,
          fileContent: '',
          branch,
          status: 'pending',
        },
      })
    })

    try {
      await reviewQueue.add(
        'analyze',
        { reviewId: review.id, workspaceId },
        { jobId: `review-${review.id}` }
      )
    } catch {
      try {
        await prisma.$transaction(async (transaction) => {
          await transaction.codeReview.updateMany({
            where: { id: review.id, workspaceId },
            data: {
              status: 'failed',
              errorMessage: 'Unable to queue review. Queue details were omitted.',
            },
          })
          if (workspace.isPersonal) {
            await releaseReviewQuota(transaction, userId, review.createdAt)
          } else {
            await releaseWorkspaceReviewQuota(
              transaction,
              workspace.organizationId,
              review.createdAt
            )
          }
        })
      } catch {
        throw new Error('Unable to queue review and release its reserved quota')
      }
      throw new Error('Unable to queue review')
    }
    return { id: review.id, status: review.status }
  }

  async updateFindingStatus(
    workspaceId: string,
    userId: string,
    findingId: string,
    status: FindingStatus,
    reason?: string
  ) {
    try {
      return await this.findingLifecycle.updateStatus(userId, findingId, status, reason, workspaceId)
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error) {
        throw new WorkspaceServiceError(
          typeof error.statusCode === 'number' ? error.statusCode : 500,
          error.message
        )
      }
      throw error
    }
  }
}
