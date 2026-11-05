import type { Prisma } from '@prisma/client'

export function reviewWorkerScope(
  reviewId: string,
  workspaceId?: string
): Prisma.CodeReviewWhereInput {
  return {
    id: reviewId,
    ...(workspaceId
      ? { workspaceId }
      : { workspace: { is: { isPersonal: true } } }),
  }
}
