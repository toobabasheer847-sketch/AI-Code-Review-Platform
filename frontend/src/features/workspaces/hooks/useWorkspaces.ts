import { useQuery, useQueryClient } from '@tanstack/react-query'

import { workspaceApi } from '../api/workspaceApi'
import { setActiveWorkspaceId } from '../store/workspace-selection'

export function useWorkspaces() {
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
