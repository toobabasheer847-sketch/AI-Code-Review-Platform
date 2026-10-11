import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { reviewApi, type ReviewSummary, type ReviewDetail } from '../api/reviewApi'

export const useListReviews = (): UseQueryResult<ReviewSummary[], Error> => {
  return useQuery<ReviewSummary[]>({ queryKey: ['reviews'], queryFn: () => reviewApi.list(), staleTime: 30_000 })
}

export const useGetReview = (id?: string): UseQueryResult<ReviewDetail, Error> => {
  return useQuery<ReviewDetail>({ queryKey: ['reviews', id], queryFn: () => reviewApi.get(id as string), enabled: !!id })
}
