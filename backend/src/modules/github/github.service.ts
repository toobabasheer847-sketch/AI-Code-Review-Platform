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
  hasRequiredGitHubScopes,
  parseGitHubGrantedScopes,
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
  sourceRevision?: string
  changedLines?: number[]
  reviewLimitations?: string[]
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
  endLine?: number | null
  severity: string
  category: string
  title?: string | null
  message: string
  evidence?: string | null
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

interface GitHubCommitResponse {
  sha: string
}

interface GitHubRepositoryResponse {
  name: string
  full_name: string
  language: string | null
  private: boolean
  updated_at: string
  html_url: string
  permissions?: {
    pull?: boolean
    push?: boolean
    admin?: boolean
  }
}

export interface GitHubDevelopmentRepository {
  fullName: string
  htmlUrl: string
  private: boolean
}

export interface GitHubDevelopmentContext {
  status: 'complete' | 'partial'
  repository: GitHubDevelopmentRepository
  commits: Array<{ sha: string; message: string; date: string | null; url: string }>
  pullRequests: Array<{
    number: number
    title: string
    state: string
    updatedAt: string
    url: string
  }>
  checks: {
    availability: 'available' | 'unavailable' | 'not_requested'
    pullRequestNumber?: number
    headSha?: string
    runs: Array<{ name: string; status: string; conclusion: string | null; url: string }>
  }
  completedReviews: Array<{
    reviewId: string
    title: string
    summary: string
    createdAt: string
    url: string
    findings: Array<{
      title: string | null
      severity: string
      category: string
      message: string
      evidence: string | null
      evidenceUrl: string
    }>
  }>
  failures: Array<{ source: string; message: string }>
}

export class GitHubIntegrationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'GitHubIntegrationError'
  }
}

interface GitHubAccountLifecycleStore {
  findCredential(userId: string): Promise<{ id: string; accessToken: string } | null>
  removeCredential(userId: string, accountId: string): Promise<void>
}

const prismaGitHubAccountLifecycleStore: GitHubAccountLifecycleStore = {
  async findCredential(userId) {
    return prisma.gitHubAccount.findUnique({
      where: { userId },
      select: { id: true, accessToken: true },
    })
  },
  async removeCredential(userId, accountId) {
    await prisma.$transaction([
      prisma.gitHubAccount.delete({ where: { id: accountId } }),
      prisma.user.update({ where: { id: userId }, data: { githubId: null } }),
    ])
  },
}

export type GitHubDevelopmentReviewProvider = (
  userId: string,
  repository: string,
  pullRequestNumber?: number
) => Promise<Array<{
  id: string
  title: string
  description: string | null
  createdAt: Date
  pullRequestUrl: string | null
  headSha: string | null
  findings: Array<{
    file: string
    line: number
    title: string | null
    severity: string
    category: string
    message: string
    evidence: string | null
  }>
}>>

const prismaDevelopmentReviewProvider: GitHubDevelopmentReviewProvider = (
  userId,
  repository,
  pullRequestNumber
) =>
  prisma.codeReview.findMany({
    where: {
      userId,
      status: 'completed',
      repository: { is: { userId, name: repository } },
      ...(pullRequestNumber !== undefined ? { pullRequestNumber } : {}),
    },
    select: {
      id: true,
      title: true,
      description: true,
      createdAt: true,
      pullRequestUrl: true,
      headSha: true,
      findings: {
        select: {
          file: true,
          line: true,
          title: true,
          severity: true,
          category: true,
          message: true,
          evidence: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

function getGitHubRetryAfter(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null
  const status = error.response?.status
  const headers = error.response?.headers
  if (status !== 429 && !(status === 403 && headers?.['x-ratelimit-remaining'] === '0')) {
    return null
  }
  const retryAfter = Number(headers?.['retry-after'])
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter)
  const resetAt = Number(headers?.['x-ratelimit-reset'])
  if (Number.isFinite(resetAt) && resetAt > 0) {
    return Math.max(1, Math.ceil(resetAt - Date.now() / 1_000))
  }
  return 60
}

function githubHtmlUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error('GitHub returned an invalid evidence URL')
  }
  return url.toString()
}

function githubFailureMessage(error: unknown): string {
  if (error instanceof GitHubIntegrationError) return error.message
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) return 'GitHub authorization was revoked or expired.'
    if (error.response?.status === 403) return 'GitHub denied this request or its rate limit was reached.'
    if (error.response?.status === 404) return 'GitHub no longer exposes this resource to the connected account.'
  }
  return 'GitHub could not provide this data.'
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

function applyReviewLimitations(
  files: ReviewSourceFile[],
  omittedPaths: string[],
  additionalLimitations: string[] = []
): ReviewSourceFile[] {
  if (files.length === 0) return files
  const limitations = [...additionalLimitations]
  if (omittedPaths.length > 0) {
    const examples = omittedPaths.slice(0, 5).join(', ')
    const remainder = omittedPaths.length > 5 ? ', and others' : ''
    limitations.push(
      `This review is partial: ${omittedPaths.length} eligible source file(s) were not included because of review file or size limits (${examples}${remainder}).`
    )
  }
  if (limitations.length > 0) files[0].reviewLimitations = limitations
  return files
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
    private readonly api: AxiosInstance = axios.create({ timeout: 15_000 }),
    private readonly accessTokenProvider?: (userId: string) => Promise<string>,
    private readonly accountLifecycleStore: GitHubAccountLifecycleStore =
      prismaGitHubAccountLifecycleStore,
    private readonly developmentReviewProvider: GitHubDevelopmentReviewProvider =
      prismaDevelopmentReviewProvider
  ) {}

  private getAccessToken(userId: string): Promise<string> {
    return this.accessTokenProvider
      ? this.accessTokenProvider(userId)
      : this.getValidatedAccessToken(userId)
  }

  private async githubRequest<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request()
    } catch (error) {
      const retryAfter = getGitHubRetryAfter(error)
      if (retryAfter !== null && retryAfter <= 60) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1_000))
        try {
          return await request()
        } catch (retryError) {
          const nextRetryAfter = getGitHubRetryAfter(retryError)
          throw new GitHubIntegrationError(
            nextRetryAfter !== null
              ? 'GitHub rate limit remains active after one bounded retry.'
              : githubFailureMessage(retryError),
            axios.isAxiosError(retryError) ? retryError.response?.status ?? 502 : 502,
            nextRetryAfter ?? undefined
          )
        }
      }
      if (retryAfter !== null) {
        throw new GitHubIntegrationError(
          'GitHub rate limit requires a later retry.',
          axios.isAxiosError(error) ? error.response?.status ?? 429 : 429,
          retryAfter
        )
      }
      if (axios.isAxiosError(error) && error.response) {
        throw new GitHubIntegrationError(
          githubFailureMessage(error),
          error.response.status
        )
      }
      throw error
    }
  }

  async validateDevelopmentRepository(
    userId: string,
    repository: string,
    requireWriteAccess = false
  ): Promise<GitHubDevelopmentRepository> {
    const [owner, name] = parseReviewRepositoryName(repository)
    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    const token = await this.getAccessToken(userId)
    const response = await this.githubRequest(() =>
      this.api.get<GitHubRepositoryResponse>(
        `${GITHUB_API_BASE}/repos/${encodedRepository}`,
        { headers: buildGitHubHeaders(token), timeout: 15_000 }
      )
    )
    if (
      response.data.full_name.toLowerCase() !== repository.toLowerCase() ||
      response.data.permissions?.pull === false ||
      (requireWriteAccess && response.data.permissions?.push !== true)
    ) {
      throw new GitHubIntegrationError(
        requireWriteAccess
          ? 'The connected GitHub account does not have write access to this repository.'
          : 'The connected GitHub account cannot read this repository.',
        403
      )
    }
    return {
      fullName: response.data.full_name,
      htmlUrl: githubHtmlUrl(response.data.html_url),
      private: response.data.private,
    }
  }

  async fetchDevelopmentContext(
    userId: string,
    repository: string,
    pullRequestNumber?: number
  ): Promise<GitHubDevelopmentContext> {
    const repo = await this.validateDevelopmentRepository(userId, repository)
    const [owner, name] = parseReviewRepositoryName(repo.fullName)
    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    const token = await this.getAccessToken(userId)
    const headers = buildGitHubHeaders(token)
    const failures: GitHubDevelopmentContext['failures'] = []
    const [commitsResult, pullRequestsResult, reviewsResult] = await Promise.allSettled([
      this.githubRequest(() =>
        this.api.get<Array<{
          sha: string
          html_url: string
          commit: { message: string; author?: { date?: string } | null }
        }>>(`${GITHUB_API_BASE}/repos/${encodedRepository}/commits`, {
          headers,
          params: { per_page: 10 },
          timeout: 15_000,
        })
      ),
      this.githubRequest(() =>
        this.api.get<Array<{
          number: number
          title: string
          state: string
          updated_at: string
          html_url: string
        }>>(`${GITHUB_API_BASE}/repos/${encodedRepository}/pulls`, {
          headers,
          params: { state: 'all', sort: 'updated', direction: 'desc', per_page: 10 },
          timeout: 15_000,
        })
      ),
      this.developmentReviewProvider(userId, repo.fullName, pullRequestNumber),
    ])

    const commits =
      commitsResult.status === 'fulfilled'
        ? commitsResult.value.data.map((commit) => ({
            sha: commit.sha,
            message: commit.commit.message.slice(0, 1_000),
            date: commit.commit.author?.date ?? null,
            url: githubHtmlUrl(commit.html_url),
          }))
        : (failures.push({ source: 'commits', message: githubFailureMessage(commitsResult.reason) }), [])
    const pullRequests =
      pullRequestsResult.status === 'fulfilled'
        ? pullRequestsResult.value.data.map((pullRequest) => ({
            number: pullRequest.number,
            title: pullRequest.title.slice(0, 300),
            state: pullRequest.state,
            updatedAt: pullRequest.updated_at,
            url: githubHtmlUrl(pullRequest.html_url),
          }))
        : (failures.push({ source: 'pull_requests', message: githubFailureMessage(pullRequestsResult.reason) }), [])
    const completedReviews =
      reviewsResult.status === 'fulfilled'
        ? reviewsResult.value.map((review) => {
            const reviewUrl = review.pullRequestUrl
              ? githubHtmlUrl(review.pullRequestUrl)
              : `${env.FRONTEND_URL}/reviews/${encodeURIComponent(review.id)}`
            const evidenceRoot = review.pullRequestUrl
              ? `${githubHtmlUrl(review.pullRequestUrl).replace(/\/pull\/\d+$/, '')}/blob/${encodeURIComponent(review.headSha ?? '')}`
              : reviewUrl
            return {
              reviewId: review.id,
              title: review.title.slice(0, 300),
              summary: (review.description ?? '').slice(0, 2_000),
              createdAt: review.createdAt.toISOString(),
              url: reviewUrl,
              findings: review.findings.map((finding) => ({
                title: finding.title,
                severity: finding.severity,
                category: finding.category,
                message: finding.message.slice(0, 1_000),
                evidence: finding.evidence?.slice(0, 500) ?? null,
                evidenceUrl: review.pullRequestUrl
                  ? `${evidenceRoot}/${finding.file.split('/').map(encodeURIComponent).join('/')}#L${finding.line}`
                  : reviewUrl,
              })),
            }
          })
        : (failures.push({ source: 'completed_reviews', message: 'Saved review results could not be loaded.' }), [])

    const checksPullRequestNumber = pullRequestNumber ?? pullRequests[0]?.number
    let checks: GitHubDevelopmentContext['checks'] = {
      availability:
        checksPullRequestNumber !== undefined || pullRequestsResult.status === 'rejected'
          ? 'unavailable'
          : 'not_requested',
      ...(checksPullRequestNumber !== undefined
        ? { pullRequestNumber: checksPullRequestNumber }
        : {}),
      runs: [],
    }
    if (checksPullRequestNumber !== undefined) {
      try {
        const target = await this.fetchPullRequestTarget(
          userId,
          repo.fullName,
          checksPullRequestNumber
        )
        const checkResponse = await this.githubRequest(() =>
          this.api.get<{
            check_runs: Array<{
              name: string
              status: string
              conclusion: string | null
              html_url: string
            }>
          }>(
            `${GITHUB_API_BASE}/repos/${encodedRepository}/commits/${encodeURIComponent(target.headSha)}/check-runs`,
            { headers, params: { per_page: 100 }, timeout: 15_000 }
          )
        )
        checks = {
          availability: 'available',
          pullRequestNumber: checksPullRequestNumber,
          headSha: target.headSha,
          runs: checkResponse.data.check_runs.map((run) => ({
            name: run.name.slice(0, 200),
            status: run.status,
            conclusion: run.conclusion,
            url: githubHtmlUrl(run.html_url),
          })),
        }
      } catch (error) {
        checks = {
          availability: 'unavailable',
          pullRequestNumber: checksPullRequestNumber,
          runs: [],
        }
        failures.push({
          source: 'ci_checks',
          message: githubFailureMessage(error),
        })
      }
    }

    return {
      status: failures.length > 0 ? 'partial' : 'complete',
      repository: repo,
      commits,
      pullRequests,
      checks,
      completedReviews,
      failures,
    }
  }

  async createDevelopmentIssue(
    userId: string,
    repository: string,
    title: string,
    body: string,
    operationId: string
  ): Promise<{ status: 'created' | 'already_created'; number: number; url: string }> {
    const repo = await this.validateDevelopmentRepository(userId, repository, true)
    const [owner, name] = parseReviewRepositoryName(repo.fullName)
    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    const token = await this.getAccessToken(userId)
    const headers = buildGitHubHeaders(token)
    const marker = `<!-- ai-codeguard-automation:${operationId} -->`
    for (let page = 1; page <= 10; page += 1) {
      const response = await this.githubRequest(() =>
        this.api.get<Array<{ number: number; html_url: string; body: string | null }>>(
          `${GITHUB_API_BASE}/repos/${encodedRepository}/issues`,
          { headers, params: { state: 'all', per_page: 100, page }, timeout: 15_000 }
        )
      )
      const existing = response.data.find((issue) => issue.body?.includes(marker))
      if (existing) {
        return {
          status: 'already_created',
          number: existing.number,
          url: githubHtmlUrl(existing.html_url),
        }
      }
      if (!response.headers.link?.includes('rel="next"')) break
      if (page === 10) throw new Error('Unable to verify issue idempotency before creating the issue.')
    }
    const response = await this.githubRequest(() =>
      this.api.post<{ number: number; html_url: string }>(
        `${GITHUB_API_BASE}/repos/${encodedRepository}/issues`,
        { title, body: `${body}\n\n${marker}` },
        { headers, timeout: 15_000 }
      )
    )
    return {
      status: 'created',
      number: response.data.number,
      url: githubHtmlUrl(response.data.html_url),
    }
  }

  async createDevelopmentPullRequestComment(
    userId: string,
    repository: string,
    pullRequestNumber: number,
    body: string,
    operationId: string
  ): Promise<{ status: 'created' | 'already_created'; id: number; url: string }> {
    const repo = await this.validateDevelopmentRepository(userId, repository, true)
    await this.fetchPullRequestTarget(userId, repo.fullName, pullRequestNumber)
    const [owner, name] = parseReviewRepositoryName(repo.fullName)
    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    const token = await this.getAccessToken(userId)
    const headers = buildGitHubHeaders(token)
    const marker = `<!-- ai-codeguard-automation:${operationId} -->`
    for (let page = 1; page <= 10; page += 1) {
      const response = await this.githubRequest(() =>
        this.api.get<Array<{ id: number; html_url: string; body: string | null }>>(
          `${GITHUB_API_BASE}/repos/${encodedRepository}/issues/${pullRequestNumber}/comments`,
          { headers, params: { per_page: 100, page }, timeout: 15_000 }
        )
      )
      const existing = response.data.find((comment) => comment.body?.includes(marker))
      if (existing) {
        return {
          status: 'already_created',
          id: existing.id,
          url: githubHtmlUrl(existing.html_url),
        }
      }
      if (!response.headers.link?.includes('rel="next"')) break
      if (page === 10) throw new Error('Unable to verify comment idempotency before posting.')
    }
    const response = await this.githubRequest(() =>
      this.api.post<{ id: number; html_url: string }>(
        `${GITHUB_API_BASE}/repos/${encodedRepository}/issues/${pullRequestNumber}/comments`,
        { body: `${body}\n\n${marker}` },
        { headers, timeout: 15_000 }
      )
    )
    return {
      status: 'created',
      id: response.data.id,
      url: githubHtmlUrl(response.data.html_url),
    }
  }

  getAuthorizeUrl(state: string): string {
    return getGitHubAuthorizeUrl(state)
  }

  async exchangeCodeForToken(code: string): Promise<{ accessToken: string; scopes: string[] }> {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.GITHUB_CALLBACK_URL) {
      throw new Error('GitHub OAuth environment variables are missing')
    }

    const response = await this.api.post<GitHubTokenResponse>(GITHUB_TOKEN_URL, getAccessTokenExchangeBody(code), {
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.data?.access_token) {
      throw new Error('Failed to exchange GitHub authorization code for access token')
    }

    const scopes = parseGitHubGrantedScopes(response.data.scope)
    if (!hasRequiredGitHubScopes(scopes)) {
      throw new Error('GitHub did not grant all required repository and identity permissions')
    }

    return { accessToken: response.data.access_token, scopes }
  }

  async fetchGitHubProfile(accessToken: string): Promise<GitHubUserProfile> {
    const response = await this.api.get<GitHubUserProfile>(`${GITHUB_API_BASE}/user`, {
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

  async saveGitHubAccount(
    userId: string,
    profile: GitHubUserProfile,
    accessToken: string,
    scopes: string[]
  ) {
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
          scopes,
          lastSuccessfulConnectionCheckAt: new Date(),
        },
        update: {
          githubId: profile.id.toString(),
          username: profile.login,
          accessToken: encryptedToken,
          scopes,
          lastSuccessfulConnectionCheckAt: new Date(),
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

  async checkConnection(userId: string): Promise<{ username: string; checkedAt: Date }> {
    const account = await prisma.gitHubAccount.findUnique({ where: { userId } })
    if (!account) {
      throw new GitHubIntegrationError('GitHub is not connected for this user.', 404)
    }
    const { plaintext: token, needsReEncryption } = decryptWithRotation(account.accessToken)
    const profile = await this.fetchGitHubProfile(token)
    if (!hasRequiredGitHubScopes(account.scopes)) {
      throw new GitHubIntegrationError('GitHub authorization is missing required permissions.', 403)
    }
    if (profile.id.toString() !== account.githubId) {
      throw new GitHubIntegrationError('GitHub returned a different account identity.', 403)
    }
    const checkedAt = new Date()
    await prisma.gitHubAccount.update({
      where: { id: account.id, userId },
      data: {
        lastSuccessfulConnectionCheckAt: checkedAt,
        ...(needsReEncryption ? { accessToken: encrypt(token) } : {}),
      },
    })
    return { username: profile.login, checkedAt }
  }

  async disconnectAccount(userId: string): Promise<{ providerRevoked: boolean }> {
    const account = await this.accountLifecycleStore.findCredential(userId)
    if (!account) return { providerRevoked: false }

    let providerRevoked = false
    try {
      const { plaintext: accessToken } = decryptWithRotation(account.accessToken)
      providerRevoked = await this.revokeAccessToken(accessToken)
    } catch {
      providerRevoked = false
    }

    await this.accountLifecycleStore.removeCredential(userId, account.id)
    return { providerRevoked }
  }

  async revokeAccessToken(accessToken: string): Promise<boolean> {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return false
    try {
      await this.api.delete(
        `${GITHUB_API_BASE}/applications/${encodeURIComponent(env.GITHUB_CLIENT_ID)}/grant`,
        {
          auth: {
            username: env.GITHUB_CLIENT_ID,
            password: env.GITHUB_CLIENT_SECRET,
          },
          data: { access_token: accessToken },
          timeout: 10_000,
        }
      )
      return true
    } catch {
      return false
    }
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
      repositoryResponse = await this.api.get<{ full_name: string; html_url: string }>(
        `${GITHUB_API_BASE}/repos/${encodedRepository}`,
        { headers, timeout: 15_000 }
      )
      await this.api.get(
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
    const commitResponse = await this.api.get<GitHubCommitResponse>(
      `${GITHUB_API_BASE}/repos/${encodedRepository}/commits/${branchPath}`,
      { headers, timeout: 15_000 }
    )
    const sourceRevision = commitResponse.data.sha
    if (!/^[\da-f]{40,64}$/i.test(sourceRevision)) {
      throw new Error('GitHub returned an invalid source revision')
    }
    const treeResponse = await this.api.get<GitHubTreeResponse>(
      `${GITHUB_API_BASE}/repos/${encodedRepository}/git/trees/${sourceRevision}`,
      { headers, params: { recursive: '1' }, timeout: 15_000 }
    )

    const tree = treeResponse.data.tree
    const selectedFiles = selectReviewTreeFiles(tree)

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
          const response = await this.api.get<string>(
            `${GITHUB_API_BASE}/repos/${encodedRepository}/contents/${filePath}`,
            {
              headers: {
                ...headers,
                Accept: 'application/vnd.github.v3.raw',
              },
              responseType: 'text',
              params: { ref: sourceRevision },
              timeout: 15_000,
            }
          )
          if (Buffer.byteLength(response.data, 'utf8') > MAX_REVIEW_FILE_BYTES) {
            throw new Error(`Source file exceeded the review size limit: ${file.path}`)
          }
          return { path: file.path, content: response.data, sourceRevision }
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

    const selectedPaths = new Set(selectedFiles.map((file) => file.path))
    const omittedPaths = tree
      .filter((item) =>
        item.type === 'blob' &&
        shouldIncludeFile(item.path) &&
        !selectedPaths.has(item.path)
      )
      .map((item) => item.path)
    return applyReviewLimitations(
      files,
      omittedPaths,
      treeResponse.data.truncated
        ? ['GitHub returned a truncated repository tree; some repository files may not have been considered.']
        : []
    )
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
    let changedFileListTruncated = false

    for (let page = 1; page <= 30; page += 1) {
      const response = await this.api.get<PullRequestFileResponse[]>(
        `${GITHUB_API_BASE}/repos/${encodedRepository}/pulls/${pullRequestNumber}/files`,
        { headers, params: { per_page: 100, page }, timeout: 15_000 }
      )
      changedFiles.push(...response.data)
      const hasNextPage = response.headers.link?.includes('rel="next"') ?? false
      if (changedFiles.length >= 3_000 && hasNextPage) {
        changedFileListTruncated = true
        break
      }
      if (!hasNextPage) break
      if (page === 30) {
        changedFileListTruncated = true
      }
    }

    const selected = changedFiles
      .filter((file) => file.status !== 'removed' && shouldIncludeFile(file.filename))
      .slice(0, MAX_REVIEW_FILES)
    const eligibleFiles = changedFiles.filter(
      (file) => file.status !== 'removed' && shouldIncludeFile(file.filename)
    )
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
        sourceRevision: expectedHeadSha,
        changedLines: getAddedPullRequestLines(changedFile.patch),
      })
    }

    if (files.length === 0) {
      throw new Error('No supported changed source files within the review size limits were found')
    }
    const fetchedPaths = new Set(files.map((file) => file.path))
    const additionalLimitations: string[] = []
    if (changedFileListTruncated) {
      additionalLimitations.push(
        'GitHub changed-file pagination reached its 3,000-file limit; additional files were not reviewed.'
      )
    }
    const patchlessFileCount = selected.filter((file) => !file.patch).length
    if (patchlessFileCount > 0) {
      additionalLimitations.push(
        `GitHub did not provide diff hunks for ${patchlessFileCount} changed source file(s), so inline locations may be unavailable.`
      )
    }
    return applyReviewLimitations(
      files,
      eligibleFiles
        .filter((file) => !fetchedPaths.has(file.filename))
        .map((file) => file.filename),
      additionalLimitations
    )
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
      .filter((finding) => {
        const addedLines = changedLines[finding.file]
        if (
          !finding.title ||
          !finding.evidence ||
          !addedLines?.includes(finding.line)
        ) {
          return false
        }
        const endLine = finding.endLine ?? finding.line
        return Array.from(
          { length: endLine - finding.line + 1 },
          (_, index) => finding.line + index
        ).every((line) => addedLines.includes(line))
      })
      .slice(0, MAX_REVIEW_FILES)
      .map((finding) => ({
        path: finding.file,
        line: finding.endLine ?? finding.line,
        ...(finding.endLine && finding.endLine > finding.line
          ? { start_line: finding.line, start_side: 'RIGHT', end_line: finding.endLine }
          : {}),
        side: 'RIGHT' as const,
        body: [
          `**${finding.severity.toUpperCase()} · ${finding.category}: ${finding.title ?? 'Review finding'}**`,
          '',
          finding.message,
          '',
          `Evidence: \`${finding.evidence ?? ''}\``,
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
    const token = await this.getAccessToken(userId)

    const response = await this.api.get<GitHubRepositoryResponse[]>(`${GITHUB_API_BASE}/user/repos`, {
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
    const token = await this.getAccessToken(userId)
    const [owner, name] = parseReviewRepositoryName(repoName)
    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    const response = await this.api.get<GitHubTreeResponse>(
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
    const token = await this.getAccessToken(userId)
    const [owner, name] = parseReviewRepositoryName(repo)
    const pathSegments = path.split('/')
    if (!path || pathSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new InvalidReviewTargetError('File path is invalid')
    }

    const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    const encodedPath = pathSegments
      .map((segment) => encodeURIComponent(segment))
      .join('/')

    const response = await this.api.get<string>(
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
