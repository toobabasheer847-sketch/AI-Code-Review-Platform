import { useQuery } from '@tanstack/react-query';
import { reviewApi } from '../api/reviewApi';
export const useListReviews = () => {
    return useQuery({
        queryKey: ['reviews'],
        queryFn: () => reviewApi.list(),
        staleTime: 30000,
        refetchInterval: (query) => query.state.data?.some((review) => review.status === 'pending' || review.status === 'running')
            ? 3000
            : false,
    });
};
export const useGetReview = (id) => {
    return useQuery({
        queryKey: ['reviews', id],
        queryFn: () => reviewApi.get(id),
        enabled: !!id,
        refetchInterval: (query) => query.state.data?.status === 'pending' || query.state.data?.status === 'running'
            ? 3000
            : false,
    });
};
