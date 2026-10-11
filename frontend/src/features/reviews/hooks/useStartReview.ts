import { useMutation, type UseMutationResult } from '@tanstack/react-query'

import { reviewApi } from '@/features/reviews/api/reviewApi'

type StartReviewVariables = {
  repository: string
  branch?: string
}

export const useStartReview = (): UseMutationResult<{ reviewId: string }, Error, StartReviewVariables> => {
  return useMutation<{ reviewId: string }, Error, StartReviewVariables>({
    mutationFn: async ({ repository, branch }: StartReviewVariables) => {
      return reviewApi.start(repository, branch)
    },
  })
}
