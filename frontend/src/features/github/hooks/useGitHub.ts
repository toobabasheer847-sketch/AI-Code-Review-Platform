import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { githubApi } from '../api/githubApi'
import { useAppStore } from '@/app/store/useAppStore'

export const githubQueryKeys = {
  repos: ['github', 'repos'] as const,
  repoFiles: (repoFullName: string) => ['github', 'repos', repoFullName, 'files'] as const,
}

export const useConnectGitHub = () => {
  return useMutation({
    mutationFn: githubApi.connect,
    onSuccess: ({ url }) => {
      window.location.assign(url)
    },
  })
}

export const useGetRepos = () => {
  const githubConnected = useAppStore((state) => state.user?.githubConnected)

  return useQuery({
    queryKey: githubQueryKeys.repos,
    queryFn: githubApi.getRepos,
    enabled: !!githubConnected,
    staleTime: 60 * 1000,
    retry: 1,
  })
}

export const useGetRepoFiles = (repoFullName: string | null) => {
  return useQuery({
    queryKey: githubQueryKeys.repoFiles(repoFullName ?? ''),
    queryFn: () => githubApi.getRepoFiles(repoFullName as string),
    enabled: !!repoFullName,
    staleTime: 60 * 1000,
    retry: 1,
  })
}

export const usePrefetchRepoFiles = () => {
  const queryClient = useQueryClient()

  return (repoFullName: string) => {
    void queryClient.prefetchQuery({
      queryKey: githubQueryKeys.repoFiles(repoFullName),
      queryFn: () => githubApi.getRepoFiles(repoFullName),
      staleTime: 60 * 1000,
    })
  }
}
