import { axiosInstance } from '@/lib/axios'

import type {
  GitHubConnectResponse,
  GitHubFileContentResponse,
  GitHubRepository,
  GitHubRepositoryFile,
} from '../types'

export const githubApi = {
  disconnect: async (): Promise<{ message: string; providerRevoked: boolean }> => {
    const response = await axiosInstance.delete<{ message: string; providerRevoked: boolean }>(
      '/github/disconnect'
    )
    return response.data
  },

  connect: async (): Promise<GitHubConnectResponse> => {
    const response = await axiosInstance.get<GitHubConnectResponse>('/github/connect')
    return response.data
  },

  getRepos: async (): Promise<GitHubRepository[]> => {
    const response = await axiosInstance.get<GitHubRepository[]>('/github/repos')
    return response.data
  },

  getRepoFiles: async (repoFullName: string): Promise<GitHubRepositoryFile[]> => {
    const response = await axiosInstance.get<GitHubRepositoryFile[]>(
      `/github/repos/${encodeURIComponent(repoFullName)}/files`
    )
    return response.data
  },

  getFileContent: async (repo: string, path: string): Promise<GitHubFileContentResponse> => {
    const response = await axiosInstance.get<GitHubFileContentResponse>('/github/file', {
      params: {
        repo,
        path,
      },
    })
    return response.data
  },
}
