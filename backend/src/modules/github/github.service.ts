import axios from 'axios'
import { prisma } from '@/config/database'
import { env } from '@/config/env'
import { decrypt, encrypt } from '@/utils/crypto'
import {
  getAccessTokenExchangeBody,
  getGitHubAuthorizeUrl,
  GITHUB_TOKEN_URL,
  GitHubTokenResponse,
  GitHubUserProfile,
} from './github.oauth'

const GITHUB_API_BASE = 'https://api.github.com'
const CODE_FILE_EXTENSIONS = new Set([
  '.js',
  '.ts',
  '.tsx',
  '.py',
])
const EXCLUDED_PATHS = [
  'node_modules/',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.webp',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.exe',
  '.dll',
  '.bin',
]

function buildGitHubHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'AI-CodeGuard',
  }
}

function shouldIncludeFile(path: string): boolean {
  const normalized = path.toLowerCase()
  if (EXCLUDED_PATHS.some((pattern) => normalized.includes(pattern))) {
    return false
  }

  return CODE_FILE_EXTENSIONS.has(`.${normalized.split('.').pop()}`)
}

export class GitHubService {
  getAuthorizeUrl(state: string): string {
    return getGitHubAuthorizeUrl(state)
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.GITHUB_CALLBACK_URL) {
      throw new Error('GitHub OAuth environment variables are missing')
    }

    const response = await axios.post<GitHubTokenResponse>(GITHUB_TOKEN_URL, getAccessTokenExchangeBody(code), {
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.data?.access_token) {
      throw new Error('Failed to exchange GitHub authorization code for access token')
    }

    return response.data.access_token
  }

  async fetchGitHubProfile(accessToken: string): Promise<GitHubUserProfile> {
    const response = await axios.get<GitHubUserProfile>(`${GITHUB_API_BASE}/user`, {
      headers: buildGitHubHeaders(accessToken),
    })

    if (!response.data?.id || !response.data?.login) {
      throw new Error('Failed to fetch GitHub profile')
    }

    return response.data
  }

  async validateAccessToken(accessToken: string): Promise<void> {
    await this.fetchGitHubProfile(accessToken)
  }

  async saveGitHubAccount(userId: string, profile: GitHubUserProfile, accessToken: string) {
    const existingAccount = await prisma.gitHubAccount.findUnique({
      where: {
        githubId: profile.id.toString(),
      },
    })

    if (existingAccount && existingAccount.userId !== userId) {
      throw new Error('This GitHub account is already connected to another user')
    }

    const encryptedToken = encrypt(accessToken)

    await prisma.$transaction([
      prisma.gitHubAccount.upsert({
        where: { userId },
        create: {
          userId,
          githubId: profile.id.toString(),
          username: profile.login,
          accessToken: encryptedToken,
        },
        update: {
          githubId: profile.id.toString(),
          username: profile.login,
          accessToken: encryptedToken,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          githubId: profile.id.toString(),
        },
      }),
    ])
  }

  async getGitHubAccount(userId: string) {
    const account = await prisma.gitHubAccount.findUnique({
      where: {
        userId,
      },
    })

    if (!account) {
      throw new Error('GitHub account not found for user')
    }

    return account
  }

  async getValidatedAccessToken(userId: string): Promise<string> {
    const account = await this.getGitHubAccount(userId)
    const token = decrypt(account.accessToken)
    await this.validateAccessToken(token)
    return token
  }

  async getRepos(userId: string) {
    const token = await this.getValidatedAccessToken(userId)

    const response = await axios.get(`${GITHUB_API_BASE}/user/repos`, {
      headers: buildGitHubHeaders(token),
      params: {
        per_page: 100,
        sort: 'updated',
        direction: 'desc',
      },
    })

    return response.data.map((repo: any) => ({
      name: repo.name,
      full_name: repo.full_name,
      language: repo.language,
      private: repo.private,
      updated_at: repo.updated_at,
      html_url: repo.html_url,
    }))
  }

  async getRepoFiles(userId: string, repoName: string) {
    const token = await this.getValidatedAccessToken(userId)

    if (!repoName.includes('/')) {
      throw new Error('Repository name must include owner and repo name')
    }

    const response = await axios.get(`${GITHUB_API_BASE}/repos/${repoName}/git/trees/HEAD`, {
      headers: buildGitHubHeaders(token),
      params: {
        recursive: '1',
      },
    })

    const tree = response.data.tree || []

    return tree
      .filter((item: any) => item.type === 'blob' && shouldIncludeFile(item.path))
      .map((item: any) => ({
        path: item.path,
        size: item.size,
        url: item.url,
      }))
  }

  async getFileContent(userId: string, repo: string, path: string) {
    const token = await this.getValidatedAccessToken(userId)

    if (!repo.includes('/') || !path) {
      throw new Error('Invalid repository or file path')
    }

    const encodedPath = path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')

    const response = await axios.get<string>(`${GITHUB_API_BASE}/repos/${repo}/contents/${encodedPath}`, {
      headers: {
        ...buildGitHubHeaders(token),
        Accept: 'application/vnd.github.v3.raw',
      },
      responseType: 'text',
    })

    return {
      content: response.data,
    }
  }
}
