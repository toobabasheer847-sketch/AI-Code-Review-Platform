import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useAppStore } from '@/app/store/useAppStore'

import { githubApi } from '../api/githubApi'
import type { GitHubConnectResponse, GitHubRepository, GitHubRepositoryFile } from '../types'

export const githubQueryKeys = {
  repos: ['github', 'repos'] as const,
  repoFiles: (repoFullName: string) => ['github', 'repos', repoFullName, 'files'] as const,
}

export const useConnectGitHub = (): UseMutationResult<GitHubConnectResponse, Error, void> => {
  return useMutation<GitHubConnectResponse, Error, void>({
    mutationFn: githubApi.connect,
    onSuccess: ({ url }) => {
      window.location.assign(url)
    },
  })
}

export const useGetRepos = (): UseQueryResult<GitHubRepository[], Error> => {
  const githubConnected = useAppStore((state) => state.user?.githubConnected)

  return useQuery({
    queryKey: githubQueryKeys.repos,
    queryFn: githubApi.getRepos,
    enabled: !!githubConnected,
    staleTime: 60 * 1000,
    retry: 1,
  })
}

export const useGetRepoFiles = (repoFullName: string | null): UseQueryResult<GitHubRepositoryFile[], Error> => {
  return useQuery<GitHubRepositoryFile[], Error>({
    queryKey: githubQueryKeys.repoFiles(repoFullName ?? ''),
    queryFn: () => githubApi.getRepoFiles(repoFullName as string),
    enabled: !!repoFullName,
    staleTime: 60 * 1000,
    retry: 1,
  })
}

export const usePrefetchRepoFiles = (): ((repoFullName: string) => void) => {
  const queryClient = useQueryClient()

  return (repoFullName: string) => {
    void queryClient.prefetchQuery({
      queryKey: githubQueryKeys.repoFiles(repoFullName),
      queryFn: () => githubApi.getRepoFiles(repoFullName),
      staleTime: 60 * 1000,
    })
  }
}
