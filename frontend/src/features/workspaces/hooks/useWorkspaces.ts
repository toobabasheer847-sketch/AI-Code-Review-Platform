import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import { workspaceApi } from '../api/workspaceApi'
import type { WorkspaceSummary } from '../domain/types'
import { setActiveWorkspaceId } from '../store/workspace-selection'

export function useWorkspaces(): UseQueryResult<WorkspaceSummary[], Error> {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: () => workspaceApi.list(),
    retry: false,
    staleTime: 30_000,
  })
}

export function useActivateWorkspace(): (workspaceId: string) => void {
  const queryClient = useQueryClient()
  return (workspaceId: string) => {
    setActiveWorkspaceId(workspaceId)
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0]
        return key !== 'me' && key !== 'workspaces'
      },
    })
  }
}
