import { useMutation, useQuery, useQueryClient, } from '@tanstack/react-query';
import { automationApi } from '../api/automationApi';
const queryKey = ['automations'];
export const useAutomations = () => useQuery({
    queryKey,
    queryFn: automationApi.list,
    refetchInterval: (query) => {
        const automations = query.state.data ?? [];
        if (automations.some((item) => item.status === 'QUEUED' || item.status === 'RUNNING')) {
            return 3000;
        }
        if (automations.some((item) => item.approvals.some((approval) => approval.status === 'PENDING'))) {
            return 60000;
        }
        return false;
    },
});
export const useCreateAutomation = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ goal, mode }) => automationApi.create(goal, mode, crypto.randomUUID()),
        onSuccess: async () => queryClient.invalidateQueries({ queryKey }),
    });
};
function useAutomationAction(action) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: action,
        onSuccess: async () => queryClient.invalidateQueries({ queryKey }),
    });
}
export const useApproveAutomation = () => useAutomationAction(automationApi.approve);
export const useRejectAutomation = () => useAutomationAction(automationApi.reject);
export const useCancelAutomation = () => useAutomationAction(automationApi.cancel);
export const useRetryAutomation = () => useAutomationAction(automationApi.retry);
