import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { automationApi, type Automation, type AutomationMode } from '../api/automationApi';

const queryKey = ['automations'];

export const useAutomations = (): UseQueryResult<Automation[], Error> =>
  useQuery({
    queryKey,
    queryFn: automationApi.list,
    refetchInterval: (query) => {
      const automations = query.state.data ?? [];
      if (automations.some((item) => item.status === 'QUEUED' || item.status === 'RUNNING')) {
        return 3_000;
      }
      if (automations.some((item) => item.approvals.some((approval) => approval.status === 'PENDING'))) {
        return 60_000;
      }
      return false;
    },
  });

export const useCreateAutomation = (): UseMutationResult<
  Automation,
  Error,
  { goal: string; mode: AutomationMode }
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ goal, mode }) => automationApi.create(goal, mode, crypto.randomUUID()),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey }),
  });
};

function useAutomationAction(
  action: (id: string) => Promise<Automation>
): UseMutationResult<Automation, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey }),
  });
}

export const useApproveAutomation = (): UseMutationResult<Automation, Error, string> =>
  useAutomationAction(automationApi.approve);

export const useRejectAutomation = (): UseMutationResult<Automation, Error, string> =>
  useAutomationAction(automationApi.reject);

export const useCancelAutomation = (): UseMutationResult<Automation, Error, string> =>
  useAutomationAction(automationApi.cancel);

export const useRetryAutomation = (): UseMutationResult<Automation, Error, string> =>
  useAutomationAction(automationApi.retry);
