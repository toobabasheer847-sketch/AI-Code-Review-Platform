import axios, { type AxiosInstance } from 'axios'
import { prisma } from '@/config/database'
import { env } from '@/config/env'
import { decryptWithRotation, encrypt } from '@/utils/crypto'
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
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.swift',
  '.kt',
  '.kts',
  '.sql',
  '.vue',
  '.svelte',
  '.sh',
])
const MAX_REVIEW_FILES = 20
const MAX_REVIEW_FILE_BYTES = 20_000
const MAX_REVIEW_TOTAL_BYTES = 100_000
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

export class InvalidReviewTargetError extends Error {
  readonly statusCode = 422

  constructor(message: string) {
    super(message)
    this.name = 'InvalidReviewTargetError'
  }
}

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

export function parseReviewRepositoryName(repository: string): [string, string] {
  const parts = repository.split('/')
  if (
    parts.length !== 2 ||
    parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')
  ) {
    throw new InvalidReviewTargetError('Repository must be a valid owner/repository name')
  }
  return [parts[0], parts[1]]
}

export function validateReviewBranchName(branch: string): void {
  const components = branch.split('/')
  if (
    branch.length === 0 ||
    branch.length > 255 ||
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.startsWith('.') ||
    branch.endsWith('.') ||
    branch.endsWith('.lock') ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.includes('@{') ||
    components.some((component) => component.startsWith('.') || component.endsWith('.lock')) ||
    [...branch].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x20 || '~^:?*\\[]'.includes(character)
    })
  ) {
    throw new InvalidReviewTargetError('Branch name is invalid')
  }
}

export interface ReviewRepositoryTarget {
  fullName: string
  htmlUrl: string
}

export interface ReviewSourceFile {
  path: string
  content: string
  changedLines?: number[]
}

export interface GitHubTreeItem {
  path: string
  type: string
  size?: number
  sha: string
  url?: string
}

export interface PullRequestFinding {
  file: string
  line: number
  severity: string
  category: string
  message: string
  suggestions: string[]
}

export interface PullRequestReviewTarget {
  fullName: string
  htmlUrl: string
  number: number
  headSha: string
  baseBranch: string
  headBranch: string
}

interface PullRequestResponse {
  number: number
  state: string
  html_url: string
  head: { sha: string; ref: string; repo: { full_name: string } | null }
  base: { ref: string; repo: { full_name: string } | null }
}

interface PullRequestFileResponse {
  filename: string
  status: string
  patch?: string
  changes: number
}

interface PullRequestReviewResponse {
  body: string | null
}

interface GitHubTreeResponse {
  truncated: boolean
  tree: GitHubTreeItem[]
}

interface GitHubRepositoryResponse {
  name: string
  full_name: string
  language: string | null
  private: boolean
  updated_at: string
  html_url: string
}

export function getAddedPullRequestLines(patch?: string): number[] {
  if (!patch) return []

  const addedLines = new Set<number>()
  let currentLine = 0
  for (const line of patch.split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      currentLine = Number(hunk[1])
      continue
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\')) continue
    if (line.startsWith('+')) {
      addedLines.add(currentLine)
      currentLine += 1
    } else if (line.startsWith(' ')) {
      currentLine += 1
    }
  }
  return [...addedLines]
}

export function selectReviewTreeFiles(tree: GitHubTreeItem[]): GitHubTreeItem[] {
  const selectedFiles: GitHubTreeItem[] = []
  let selectedBytes = 0
  for (const item of tree) {
    const size = item.size ?? 0
    if (
      item.type !== 'blob' ||
      !shouldIncludeFile(item.path) ||
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > MAX_REVIEW_FILE_BYTES ||
      selectedBytes + size > MAX_REVIEW_TOTAL_BYTES
    ) {
      continue
    }
    selectedFiles.push(item)
    selectedBytes += size
    if (selectedFiles.length === MAX_REVIEW_FILES) break
  }

  if (selectedFiles.length === 0) {
    throw new Error('No supported source files within the review size limits were found')
  }
  return selectedFiles
}

function parsePullRequestResponse(
  response: PullRequestResponse,
  repository: string,
  pullRequestNumber: number
): PullRequestReviewTarget {
  if (
    response.number !== pullRequestNumber ||
    response.state !== 'open' ||
    !response.head.repo ||
    !response.base.repo ||
    response.head.repo.full_name.toLowerCase() !== repository.toLowerCase() ||
    response.base.repo.full_name.toLowerCase() !== repository.toLowerCase() ||
    !/^[\da-f]{40}$/i.test(response.head.sha)
  ) {
    throw new InvalidReviewTargetError('Pull request is closed or does not belong to this repository')
  }

  return {
    fullName: response.base.repo.full_name,
    htmlUrl: response.html_url,
    number: response.number,
    headSha: response.head.sha,
    baseBranch: response.base.ref,
    headBranch: response.head.ref,
  }
}

export class GitHubService {
  constructor(
    private readonly api: AxiosInstance = axios,
    private readonly accessTokenProvider?: (userId: string) => Promise<string>
  ) {}

  private getAccessToken(userId: string): Promise<string> {
    return this.accessTokenProvider
      ? this.accessTokenProvider(userId)
      : this.getValidatedAccessToken(userId)
  }

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
    const { plaintext: token, needsReEncryption } = decryptWithRotation(account.accessToken)
    await this.validateAccessToken(token)
    if (needsReEncryption) {
      await prisma.gitHubAccount.update({
        where: { id: account.id },
        data: { accessToken: encrypt(token) },
      })
    }
    return token
  }

  async validateReviewTarget(
    userId: string,
    repository: string,
    branch: string
  ): Promise<ReviewRepositoryTarget> {
    const [owner, name] = parseReviewRepositoryName(repository)
    validateReviewBranchName(branch)
    const token = await this.getAccessToken(userId)
    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    const headers = buildGitHubHeaders(token)
    let repositoryResponse
    try {
      repositoryResponse = await axios.get<{ full_name: string; html_url: string }>(
        `${GITHUB_API_BASE}/repos/${encodedRepository}`,
        { headers, timeout: 15_000 }
      )
      await axios.get(
        `${GITHUB_API_BASE}/repos/${encodedRepository}/branches/${branch
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        { headers, timeout: 15_000 }
      )
    } catch (error) {
      if (axios.isAxiosError(error) && [403, 404].includes(error.response?.status ?? 0)) {
        throw new InvalidReviewTargetError(
          'The connected GitHub account cannot access this repository or branch'
        )
      }
      throw error
    }

    if (repositoryResponse.data.full_name.toLowerCase() !== repository.toLowerCase()) {
      throw new InvalidReviewTargetError(
        'GitHub repository name did not match the requested repository'
      )
    }

    return {
      fullName: repositoryResponse.data.full_name,
      htmlUrl: repositoryResponse.data.html_url,
    }
  }

  async fetchReviewFiles(
    userId: string,
    repository: string,
    branch: string
  ): Promise<ReviewSourceFile[]> {
    const [owner, name] = parseReviewRepositoryName(repository)
    validateReviewBranchName(branch)
    const token = await this.getAccessToken(userId)
    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    const branchPath = branch.split('/').map(encodeURIComponent).join('/')
    const headers = buildGitHubHeaders(token)
    const treeResponse = await axios.get<GitHubTreeResponse>(
      `${GITHUB_API_BASE}/repos/${encodedRepository}/git/trees/${branchPath}`,
      { headers, params: { recursive: '1' }, timeout: 15_000 }
    )

    if (treeResponse.data.truncated) {
      throw new Error('Repository tree is too large for a complete review')
    }

    const selectedFiles = selectReviewTreeFiles(treeResponse.data.tree)

    const files: ReviewSourceFile[] = []
    let fetchedBytes = 0
    for (let index = 0; index < selectedFiles.length; index += 4) {
      const batch = selectedFiles.slice(index, index + 4)
      const fetched = await Promise.all(
        batch.map(async (file) => {
          const filePath = file.path
            .split('/')
            .map(encodeURIComponent)
            .join('/')
          const response = await axios.get<string>(
            `${GITHUB_API_BASE}/repos/${encodedRepository}/contents/${filePath}`,
            {
              headers: {
                ...headers,
                Accept: 'application/vnd.github.v3.raw',
              },
              responseType: 'text',
              params: { ref: branch },
              timeout: 15_000,
            }
          )
          if (Buffer.byteLength(response.data, 'utf8') > MAX_REVIEW_FILE_BYTES) {
            throw new Error(`Source file exceeded the review size limit: ${file.path}`)
          }
          return { path: file.path, content: response.data }
        })
      )
      const batchBytes = fetched.reduce(
        (total, file) => total + Buffer.byteLength(file.content, 'utf8'),
        0
      )
      if (fetchedBytes + batchBytes > MAX_REVIEW_TOTAL_BYTES) {
        throw new Error('Repository source exceeded the total review size limit')
      }
      fetchedBytes += batchBytes
      files.push(...fetched)
    }

    return files
  }

  async fetchPullRequestTarget(
    userId: string,
    repository: string,
    pullRequestNumber: number
  ): Promise<PullRequestReviewTarget> {
    const [owner, name] = parseReviewRepositoryName(repository)
    if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) {
      throw new InvalidReviewTargetError('Pull request number is invalid')
    }

    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    try {
      const token = await this.getAccessToken(userId)
      const response = await this.api.get<PullRequestResponse>(
        `${GITHUB_API_BASE}/repos/${encodedRepository}/pulls/${pullRequestNumber}`,
        { headers: buildGitHubHeaders(token), timeout: 15_000 }
      )
      return parsePullRequestResponse(response.data, repository, pullRequestNumber)
    } catch (error) {
      if (
        error instanceof InvalidReviewTargetError ||
        (error instanceof Error && error.message === 'GitHub account not found for user') ||
        (axios.isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0))
      ) {
        throw new InvalidReviewTargetError(
          'The connected GitHub account cannot access this pull request'
        )
      }
      throw error
    }
  }

  async fetchPullRequestFiles(
    userId: string,
    repository: string,
    pullRequestNumber: number,
    expectedHeadSha: string
  ): Promise<ReviewSourceFile[]> {
    const target = await this.fetchPullRequestTarget(userId, repository, pullRequestNumber)
    if (target.headSha !== expectedHeadSha) {
      throw new InvalidReviewTargetError('Pull request head changed before review processing')
    }
    const [owner, name] = parseReviewRepositoryName(repository)
    const token = await this.getAccessToken(userId)
    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    const headers = buildGitHubHeaders(token)
    const changedFiles: PullRequestFileResponse[] = []

    for (let page = 1; page <= 30; page += 1) {
      const response = await this.api.get<PullRequestFileResponse[]>(
        `${GITHUB_API_BASE}/repos/${encodedRepository}/pulls/${pullRequestNumber}/files`,
        { headers, params: { per_page: 100, page }, timeout: 15_000 }
      )
      changedFiles.push(...response.data)
      const hasNextPage = response.headers.link?.includes('rel="next"') ?? false
      if (changedFiles.length >= 3_000 && hasNextPage) {
        throw new Error('Pull request changed-file list exceeds the review limit')
      }
      if (!hasNextPage) break
      if (page === 30) {
        throw new Error('Pull request changed-file list exceeds the review limit')
      }
    }

    const selected = changedFiles
      .filter((file) => file.status !== 'removed' && shouldIncludeFile(file.filename))
      .slice(0, MAX_REVIEW_FILES)
    const files: ReviewSourceFile[] = []
    let totalBytes = 0

    for (const changedFile of selected) {
      const encodedPath = changedFile.filename
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      const response = await this.api.get<string>(
        `${GITHUB_API_BASE}/repos/${encodedRepository}/contents/${encodedPath}`,
        {
          headers: { ...headers, Accept: 'application/vnd.github.v3.raw' },
          params: { ref: expectedHeadSha },
          responseType: 'text',
          timeout: 15_000,
        }
      )
      const size = Buffer.byteLength(response.data, 'utf8')
      if (size > MAX_REVIEW_FILE_BYTES || totalBytes + size > MAX_REVIEW_TOTAL_BYTES) continue
      totalBytes += size
      files.push({
        path: changedFile.filename,
        content: response.data,
        changedLines: getAddedPullRequestLines(changedFile.patch),
      })
    }

    if (files.length === 0) {
      throw new Error('No supported changed source files within the review size limits were found')
    }
    return files
  }

  async publishPullRequestFindings(
    userId: string,
    repository: string,
    pullRequestNumber: number,
    expectedHeadSha: string,
    reviewId: string,
    findings: PullRequestFinding[],
    changedLines: Record<string, number[]>
  ): Promise<'published' | 'already-published' | 'no-inline-findings' | 'stale'> {
    const target = await this.fetchPullRequestTarget(userId, repository, pullRequestNumber)
    if (target.headSha !== expectedHeadSha) return 'stale'

    const comments = findings
      .filter((finding) => changedLines[finding.file]?.includes(finding.line))
      .slice(0, MAX_REVIEW_FILES)
      .map((finding) => ({
        path: finding.file,
        line: finding.line,
        side: 'RIGHT' as const,
        body: [
          `**${finding.severity.toUpperCase()} · ${finding.category}**`,
          '',
          finding.message,
          ...(finding.suggestions.length
            ? ['', `Suggestion: ${finding.suggestions.join(' ')}`]
            : []),
        ].join('\n'),
      }))
    if (comments.length === 0) return 'no-inline-findings'

    const token = await this.getAccessToken(userId)
    const [owner, name] = parseReviewRepositoryName(repository)
    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    const marker = `<!-- ai-codeguard-review:${reviewId} -->`
    const headers = buildGitHubHeaders(token)
    let page = 1
    for (; page <= 10; page += 1) {
      const response = await this.api.get<PullRequestReviewResponse[]>(
        `${GITHUB_API_BASE}/repos/${encodedRepository}/pulls/${pullRequestNumber}/reviews`,
        { headers, params: { per_page: 100, page }, timeout: 15_000 }
      )
      if (response.data.some((existing) => existing.body?.includes(marker))) {
        return 'already-published'
      }
      if (!response.headers.link?.includes('rel="next"')) break
    }
    if (page > 10) {
      throw new Error('Unable to verify whether this pull request review was already published')
    }

    await this.api.post(
      `${GITHUB_API_BASE}/repos/${encodedRepository}/pulls/${pullRequestNumber}/reviews`,
      {
        commit_id: expectedHeadSha,
        body: `AI CodeGuard found ${comments.length} actionable issue(s).\n\n${marker}`,
        event: 'COMMENT',
        comments,
      },
      { headers, timeout: 15_000 }
    )
    return 'published'
  }

  async getRepos(userId: string) {
    const token = await this.getValidatedAccessToken(userId)

    const response = await axios.get<GitHubRepositoryResponse[]>(`${GITHUB_API_BASE}/user/repos`, {
      headers: buildGitHubHeaders(token),
      params: {
        per_page: 100,
        sort: 'updated',
        direction: 'desc',
      },
    })

    return response.data.map((repo) => ({
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
    const [owner, name] = parseReviewRepositoryName(repoName)
    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    const response = await axios.get<GitHubTreeResponse>(
      `${GITHUB_API_BASE}/repos/${encodedRepository}/git/trees/HEAD`,
      {
        headers: buildGitHubHeaders(token),
        params: {
          recursive: '1',
        },
      }
    )

    const tree = response.data.tree || []

    return tree
      .filter((item) => item.type === 'blob' && shouldIncludeFile(item.path))
      .map((item) => ({
        path: item.path,
        size: item.size,
        url: item.url,
      }))
  }

  async getFileContent(userId: string, repo: string, path: string) {
    const token = await this.getValidatedAccessToken(userId)
    const [owner, name] = parseReviewRepositoryName(repo)
    const pathSegments = path.split('/')
    if (!path || pathSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error('Invalid repository or file path')
    }

    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    const encodedPath = pathSegments
      .map((segment) => encodeURIComponent(segment))
      .join('/')

    const response = await axios.get<string>(
      `${GITHUB_API_BASE}/repos/${encodedRepository}/contents/${encodedPath}`,
      {
      headers: {
        ...buildGitHubHeaders(token),
        Accept: 'application/vnd.github.v3.raw',
      },
      responseType: 'text',
      }
    )

    return {
      content: response.data,
    }
  }
}
