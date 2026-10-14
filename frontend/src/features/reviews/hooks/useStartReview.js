import { useMutation } from '@tanstack/react-query';
import { reviewApi } from '@/features/reviews/api/reviewApi';
export const useStartReview = () => {
    return useMutation({
        mutationFn: async ({ repository, branch }) => {
            return reviewApi.start(repository, branch);
        },
    });
};
