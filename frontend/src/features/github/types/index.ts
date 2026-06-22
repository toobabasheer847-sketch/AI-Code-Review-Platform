export interface GitHubRepository {
  name: string
  full_name: string
  language: string | null
  private: boolean
  updated_at: string
  html_url?: string
}

export interface GitHubRepositoryFile {
  path: string
  size: number
  url: string
}

export interface GitHubConnectResponse {
  url: string
}

export interface GitHubFileContentResponse {
  content: string
}
