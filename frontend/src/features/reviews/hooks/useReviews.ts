import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { reviewApi, type ReviewSummary, type ReviewDetail } from '../api/reviewApi'

export const useListReviews = (): UseQueryResult<ReviewSummary[], Error> => {
  return useQuery<ReviewSummary[]>({
    queryKey: ['reviews'],
    queryFn: () => reviewApi.list(),
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.some((review) => review.status === 'pending' || review.status === 'running')
        ? 3_000
        : false,
  })
}

export const useGetReview = (id?: string): UseQueryResult<ReviewDetail, Error> => {
  return useQuery<ReviewDetail>({
    queryKey: ['reviews', id],
    queryFn: () => reviewApi.get(id as string),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' || query.state.data?.status === 'running'
        ? 3_000
        : false,
  })
}
