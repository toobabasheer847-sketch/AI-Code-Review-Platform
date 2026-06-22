import { useQuery } from '@tanstack/react-query'
import { reviewApi, type ReviewSummary, type ReviewDetail } from '../api/reviewApi'

export const useListReviews = () => {
  return useQuery<ReviewSummary[]>({ queryKey: ['reviews'], queryFn: () => reviewApi.list(), staleTime: 30_000 })
}

export const useGetReview = (id?: string) => {
  return useQuery<ReviewDetail>({ queryKey: ['reviews', id], queryFn: () => reviewApi.get(id as string), enabled: !!id })
}
