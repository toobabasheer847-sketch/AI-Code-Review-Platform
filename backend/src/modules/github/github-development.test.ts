import assert from 'node:assert/strict'
import axios, { type AxiosAdapter, type AxiosResponse } from 'axios'
import test from 'node:test'
import {
  GitHubIntegrationError,
  GitHubService,
  type GitHubDevelopmentReviewProvider,
} from './github.service'

const sha = 'a'.repeat(40)
const reviewProvider: GitHubDevelopmentReviewProvider = async (userId, repository, prNumber) => {
  assert.equal(userId, 'user-a')
  assert.equal(repository, 'owner/repository')
  assert.equal(prNumber, 7)
  return [
    {
      id: 'review-1',
      title: 'Review pull request',
      description: 'The review reported a missing input guard.',
      createdAt: new Date('2026-10-15T12:00:00.000Z'),
      pullRequestUrl: 'https://github.com/owner/repository/pull/7',
      headSha: sha,
      findings: [
        {
          file: 'src/app.ts',
          line: 19,
          title: 'Validate request input',
          severity: 'high',
          category: 'security',
          message: 'The request value is used without validation.',
          evidence: 'handle(input.value)',
        },
      ],
    },
  ]
}

function apiResponse<T>(
  config: Parameters<AxiosAdapter>[0],
  data: T,
  headers: Record<string, string> = {}
): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers, config }
}

function apiError(
  config: Parameters<AxiosAdapter>[0],
  status: number,
  headers: Record<string, string> = {}
): Error {
  const response = {
    data: { message: 'provider detail must not leak' },
    status,
    statusText: 'Error',
    headers,
    config,
  }
  return new axios.AxiosError(
    'GitHub request failed',
    'ERR_BAD_REQUEST',
    config,
    undefined,
    response
  )
}

function createGitHubService(
  adapter: AxiosAdapter,
  reviews: GitHubDevelopmentReviewProvider = reviewProvider
): GitHubService {
  return new GitHubService(
    axios.create({ adapter }),
    async (userId) => {
      assert.equal(userId, 'user-a')
      return 'private-test-token'
    },
    undefined,
    reviews
  )
}

function repositoryResponse(config: Parameters<AxiosAdapter>[0], push = true) {
  return apiResponse(
    config,
    {
      name: 'repository',
      full_name: 'owner/repository',
      language: 'TypeScript',
      private: true,
      updated_at: '2026-10-15T12:00:00.000Z',
      html_url: 'https://github.com/owner/repository',
      permissions: { pull: true, push, admin: false },
    }
  )
}

test('repository access is authenticated, name-bound, and write-gated', async () => {
  const authorizationHeaders: unknown[] = []
  const github = createGitHubService(async (config) => {
    authorizationHeaders.push(config.headers?.Authorization)
    return repositoryResponse(config, false)
  })
  const repo = await github.validateDevelopmentRepository('user-a', 'OWNER/REPOSITORY')
  assert.deepEqual(repo, {
    fullName: 'owner/repository',
    htmlUrl: 'https://github.com/owner/repository',
    private: true,
  })
  assert.equal(authorizationHeaders.length, 1)
  assert.equal(authorizationHeaders[0], 'Bearer private-test-token')
  await assert.rejects(
    github.validateDevelopmentRepository('user-a', 'owner/repository', true),
    (error: unknown) =>
      error instanceof GitHubIntegrationError &&
      error.statusCode === 403 &&
      !error.message.includes('private-test-token')
  )
})

test('repository access failures are surfaced without returning unauthorized data', async () => {
  const github = createGitHubService(async (config) => {
    throw apiError(config, 404)
  })
  await assert.rejects(
    github.validateDevelopmentRepository('user-a', 'owner/repository'),
    (error: unknown) =>
      error instanceof GitHubIntegrationError &&
      error.statusCode === 404 &&
      !error.message.includes('provider detail')
  )
})

test('context reports partial and failed CI accurately and links reviews to evidence', async () => {
  const github = createGitHubService(async (config) => {
    const url = config.url ?? ''
    if (url.endsWith('/repos/owner/repository')) return repositoryResponse(config)
    if (url.endsWith('/commits')) {
      return apiResponse(config, [
        {
          sha,
          html_url: `https://github.com/owner/repository/commit/${sha}`,
          commit: { message: 'Fix request guard', author: { date: '2026-10-15T12:00:00Z' } },
        },
      ])
    }
    if (url.endsWith('/pulls') && !url.endsWith('/pulls/7')) {
      throw apiError(config, 502)
    }
    if (url.endsWith('/pulls/7')) {
      return apiResponse(config, {
        number: 7,
        state: 'open',
        html_url: 'https://github.com/owner/repository/pull/7',
        head: { sha, ref: 'feature', repo: { full_name: 'owner/repository' } },
        base: { ref: 'main', repo: { full_name: 'owner/repository' } },
      })
    }
    if (url.includes('/check-runs')) {
      return apiResponse(config, {
        check_runs: [
          {
            name: 'test',
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://github.com/owner/repository/actions/runs/45',
          },
        ],
      })
    }
    throw new Error(`Unexpected GitHub API request: ${url}`)
  })

  const result = await github.fetchDevelopmentContext('user-a', 'owner/repository', 7)
  assert.equal(result.status, 'partial')
  assert.equal(result.pullRequests.length, 0)
  assert.deepEqual(result.failures.map(({ source }) => source), ['pull_requests'])
  assert.equal(result.checks.availability, 'available')
  assert.equal(result.checks.runs[0]?.conclusion, 'failure')
  assert.equal(result.completedReviews[0]?.findings[0]?.evidenceUrl,
    `https://github.com/owner/repository/blob/${sha}/src/app.ts#L19`)
  assert.equal(result.completedReviews[0]?.url, 'https://github.com/owner/repository/pull/7')
})

test('missing CI permission is marked unavailable instead of implying checks passed', async () => {
  const github = createGitHubService(async (config) => {
    const url = config.url ?? ''
    if (url.endsWith('/repos/owner/repository')) return repositoryResponse(config)
    if (url.endsWith('/commits') || url.endsWith('/pulls')) return apiResponse(config, [])
    if (url.endsWith('/pulls/7')) {
      return apiResponse(config, {
        number: 7,
        state: 'open',
        html_url: 'https://github.com/owner/repository/pull/7',
        head: { sha, ref: 'feature', repo: { full_name: 'owner/repository' } },
        base: { ref: 'main', repo: { full_name: 'owner/repository' } },
      })
    }
    if (url.includes('/check-runs')) throw apiError(config, 403)
    throw new Error(`Unexpected GitHub API request: ${url}`)
  })
  const result = await github.fetchDevelopmentContext('user-a', 'owner/repository', 7)
  assert.equal(result.status, 'partial')
  assert.equal(result.checks.availability, 'unavailable')
  assert.deepEqual(result.checks.runs, [])
  assert.match(result.failures[0]?.message ?? '', /denied/)
})

test('repository briefs include checks for the most recently updated pull request', async () => {
  const github = createGitHubService(
    async (config) => {
      const url = config.url ?? ''
      if (url.endsWith('/repos/owner/repository')) return repositoryResponse(config)
      if (url.endsWith('/commits')) return apiResponse(config, [])
      if (url.endsWith('/pulls') && !url.endsWith('/pulls/9')) {
        return apiResponse(config, [
          {
            number: 9,
            title: 'Latest work',
            state: 'open',
            updated_at: '2026-10-15T12:00:00Z',
            html_url: 'https://github.com/owner/repository/pull/9',
          },
        ])
      }
      if (url.endsWith('/pulls/9')) {
        return apiResponse(config, {
          number: 9,
          state: 'open',
          html_url: 'https://github.com/owner/repository/pull/9',
          head: { sha, ref: 'feature', repo: { full_name: 'owner/repository' } },
          base: { ref: 'main', repo: { full_name: 'owner/repository' } },
        })
      }
      if (url.includes('/check-runs')) {
        return apiResponse(config, {
          check_runs: [
            {
              name: 'unit tests',
              status: 'completed',
              conclusion: 'success',
              html_url: 'https://github.com/owner/repository/actions/runs/99',
            },
          ],
        })
      }
      throw new Error(`Unexpected GitHub API request: ${url}`)
    },
    async (_userId, _repository, pullRequestNumber) => {
      assert.equal(pullRequestNumber, undefined)
      return []
    }
  )

  const result = await github.fetchDevelopmentContext('user-a', 'owner/repository')
  assert.equal(result.checks.availability, 'available')
  assert.equal(result.checks.pullRequestNumber, 9)
  assert.equal(result.checks.runs[0]?.conclusion, 'success')
})

test('repository brief marks CI unavailable when recent pull requests cannot be read', async () => {
  const github = createGitHubService(
    async (config) => {
      const url = config.url ?? ''
      if (url.endsWith('/repos/owner/repository')) return repositoryResponse(config)
      if (url.endsWith('/commits')) return apiResponse(config, [])
      if (url.endsWith('/pulls')) throw apiError(config, 403)
      throw new Error(`Unexpected GitHub API request: ${url}`)
    },
    async () => []
  )

  const result = await github.fetchDevelopmentContext('user-a', 'owner/repository')
  assert.equal(result.status, 'partial')
  assert.equal(result.checks.availability, 'unavailable')
  assert.deepEqual(result.checks.runs, [])
})

test('issue creation is allowlisted, marker-idempotent, and returns a traceable link', async () => {
  const calls: string[] = []
  let storedIssueBody = ''
  const github = createGitHubService(async (config) => {
    const url = config.url ?? ''
    const method = config.method?.toUpperCase()
    calls.push(`${method} ${url}`)
    if (url.endsWith('/repos/owner/repository')) return repositoryResponse(config)
    if (url.endsWith('/issues') && method === 'GET') {
      return apiResponse(config, storedIssueBody
        ? [{ number: 99, html_url: 'https://github.com/owner/repository/issues/99', body: storedIssueBody }]
        : [])
    }
    if (url.endsWith('/issues') && method === 'POST') {
      storedIssueBody = String(config.data)
      return apiResponse(config, {
        number: 99,
        html_url: 'https://github.com/owner/repository/issues/99',
      })
    }
    throw new Error(`Unexpected GitHub API request: ${url}`)
  })

  const first = await github.createDevelopmentIssue(
    'user-a',
    'owner/repository',
    'Add input guard',
    'Reject invalid request values.',
    'task-issue-1'
  )
  const second = await github.createDevelopmentIssue(
    'user-a',
    'owner/repository',
    'Add input guard',
    'Reject invalid request values.',
    'task-issue-1'
  )
  assert.deepEqual(first, {
    status: 'created',
    number: 99,
    url: 'https://github.com/owner/repository/issues/99',
  })
  assert.deepEqual(second, { ...first, status: 'already_created' })
  assert.match(storedIssueBody, /ai-codeguard-automation:task-issue-1/)
  assert.equal(calls.filter((call) => call.startsWith('POST ')).length, 1)
})

test('PR comment creation rechecks the open target and deduplicates uncertain retries', async () => {
  let storedComment = ''
  let posts = 0
  const github = createGitHubService(async (config) => {
    const url = config.url ?? ''
    const method = config.method?.toUpperCase()
    if (url.endsWith('/repos/owner/repository')) return repositoryResponse(config)
    if (url.endsWith('/pulls/7')) {
      return apiResponse(config, {
        number: 7,
        state: 'open',
        html_url: 'https://github.com/owner/repository/pull/7',
        head: { sha, ref: 'feature', repo: { full_name: 'owner/repository' } },
        base: { ref: 'main', repo: { full_name: 'owner/repository' } },
      })
    }
    if (url.endsWith('/issues/7/comments') && method === 'GET') {
      return apiResponse(config, storedComment
        ? [{ id: 41, html_url: 'https://github.com/owner/repository/pull/7#issuecomment-41', body: storedComment }]
        : [])
    }
    if (url.endsWith('/issues/7/comments') && method === 'POST') {
      posts += 1
      storedComment = String(config.data)
      return apiResponse(config, {
        id: 41,
        html_url: 'https://github.com/owner/repository/pull/7#issuecomment-41',
      })
    }
    throw new Error(`Unexpected GitHub API request: ${url}`)
  })
  const first = await github.createDevelopmentPullRequestComment(
    'user-a',
    'owner/repository',
    7,
    'Please add the missing test.',
    'task-comment-1'
  )
  const retry = await github.createDevelopmentPullRequestComment(
    'user-a',
    'owner/repository',
    7,
    'Please add the missing test.',
    'task-comment-1'
  )
  assert.equal(first.status, 'created')
  assert.equal(retry.status, 'already_created')
  assert.equal(retry.url, first.url)
  assert.match(storedComment, /ai-codeguard-automation:task-comment-1/)
  assert.equal(posts, 1)
})

test('GitHub write API failures are surfaced and never shaped as success', async () => {
  const github = createGitHubService(async (config) => {
    if ((config.url ?? '').endsWith('/repos/owner/repository')) {
      return repositoryResponse(config)
    }
    if ((config.url ?? '').endsWith('/issues')) throw apiError(config, 403)
    throw new Error('Unexpected GitHub API request')
  })
  await assert.rejects(
    github.createDevelopmentIssue(
      'user-a',
      'owner/repository',
      'Issue title',
      'Issue body',
      'task-fail'
    ),
    (error: unknown) =>
      error instanceof GitHubIntegrationError &&
      error.statusCode === 403 &&
      !('url' in error)
  )
})

test('revoked credentials produce an explicit authorization failure', async () => {
  const github = createGitHubService(async (config) => {
    throw apiError(config, 401)
  })
  await assert.rejects(
    github.validateDevelopmentRepository('user-a', 'owner/repository'),
    (error: unknown) =>
      error instanceof GitHubIntegrationError &&
      error.statusCode === 401 &&
      /revoked or expired/.test(error.message)
  )
})

test('GitHub rate limits receive one bounded retry using the server retry hint', async () => {
  let calls = 0
  const github = createGitHubService(async (config) => {
    calls += 1
    if (calls === 1) throw apiError(config, 429, { 'retry-after': '1' })
    return repositoryResponse(config)
  })
  await github.validateDevelopmentRepository('user-a', 'owner/repository')
  assert.equal(calls, 2)
})
