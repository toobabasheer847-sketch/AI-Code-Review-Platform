import { prisma } from '@/config/database'
import type { ReviewJobRecord } from '@/modules/code-review/review.pipeline'
import { reviewWorkerScope } from './review.worker-domain'

export async function findReviewForProcessing(
  reviewId: string,
  workspaceId?: string
): Promise<ReviewJobRecord | null> {
  const review = await prisma.codeReview.findFirst({
    where: reviewWorkerScope(reviewId, workspaceId),
    include: {
      workspace: { select: { isPersonal: true } },
      repository: { select: { id: true, name: true } },
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
          impact: true,
          evidence: true,
          suggestions: true,
        },
      },
    },
  })
  if (!review || !review.workspaceId) return null
  if (review.workspace && !review.workspace.isPersonal) {
    const activeMembership = await prisma.workspaceMembership.findFirst({
      where: {
        workspaceId: review.workspaceId,
        userId: review.userId,
        status: 'ACTIVE',
      },
      select: { id: true },
    })
    if (!activeMembership) return null
  }
  return review
}
