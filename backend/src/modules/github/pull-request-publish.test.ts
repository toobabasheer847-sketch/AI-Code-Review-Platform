import assert from 'node:assert/strict'
import axios from 'axios'
import test from 'node:test'
import { env } from '@/config/env'
import { encrypt } from '@/utils/crypto'
import {
  GitHubService,
  type PullRequestFinding,
} from './github.service'

const pullRequest = {
  number: 7,
  state: 'open',
  html_url: 'https://github.com/owner/repository/pull/7',
  head: { sha: 'a'.repeat(40), ref: 'feature', repo: { full_name: 'owner/repository' } },
  base: { ref: 'main', repo: { full_name: 'owner/repository' } },
}

const findings: PullRequestFinding[] = [
  {
    file: 'src/app.ts',
    line: 10,
    endLine: 11,
    title: 'Unvalidated input',
    severity: 'error',
    category: 'security',
    message: 'Validate the input before use.',
    evidence: 'dangerousCall(input)',
    suggestions: ['Reject invalid values.'],
  },
  {
    file: 'src/app.ts',
    line: 4,
    title: 'Unchanged line',
    severity: 'warning',
    category: 'quality',
    message: 'This line was not changed by the pull request.',
    evidence: 'dangerousCall(input)',
    suggestions: [],
  },
]

function createService(options: {
  existingMarker?: boolean
  failPost?: boolean
} = {}) {
  const calls: Array<{ method: string; url: string; data?: unknown }> = []
  const api = axios.create({
    adapter: async (config) => {
      const method = config.method?.toUpperCase() ?? 'GET'
      const url = config.url ?? ''
      calls.push({ method, url, data: config.data })
      if (method === 'POST' && options.failPost) {
        throw new Error('GitHub API rate limit')
      }

      let data: unknown = []
      if (url.includes('/pulls/7') && !url.includes('/reviews')) data = pullRequest
      if (url.includes('/reviews') && options.existingMarker) {
        data = [{ body: '<!-- ai-codeguard-review:review-1 -->' }]
      }
      return {
        data,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    },
  })
  const github = new GitHubService(api, async () => 'mock-oauth-token')
  return { github, calls }
}

test('publishes only findings on valid added lines and includes a retry marker', async () => {
  const { github, calls } = createService()
  const result = await github.publishPullRequestFindings(
    'user-1',
    'owner/repository',
    7,
    pullRequest.head.sha,
    'review-1',
    findings,
    { 'src/app.ts': [10, 11] }
  )

  assert.equal(result, 'published')
  const post = calls.find((call) => call.method === 'POST')
  assert.ok(post)
  const payload = JSON.parse(post.data as string) as {
    event: string
    commit_id: string
    body: string
    comments: Array<{ path: string; line: number; side: string; body: string }>
  }
  assert.equal(payload.event, 'COMMENT')
  assert.equal(payload.commit_id, pullRequest.head.sha)
  assert.match(payload.body, /ai-codeguard-review:review-1/)
  assert.deepEqual(payload.comments, [
    {
      path: 'src/app.ts',
      line: 11,
      start_line: 10,
      start_side: 'RIGHT',
      end_line: 11,
      side: 'RIGHT',
      body: payload.comments[0].body,
    },
  ])
  assert.match(payload.comments[0].body, /Unvalidated input/)
  assert.match(payload.comments[0].body, /dangerousCall/)
})

test('does not republish an existing review marker or comment on stale commits', async () => {
  const duplicate = createService({ existingMarker: true })
  assert.equal(
    await duplicate.github.publishPullRequestFindings(
      'user-1',
      'owner/repository',
      7,
      pullRequest.head.sha,
      'review-1',
      findings,
      { 'src/app.ts': [10, 11] }
    ),
    'already-published'
  )
  assert.equal(duplicate.calls.some((call) => call.method === 'POST'), false)

  const stale = createService()
  assert.equal(
    await stale.github.publishPullRequestFindings(
      'user-1',
      'owner/repository',
      7,
      'b'.repeat(40),
      'review-2',
      findings,
      { 'src/app.ts': [10, 11] }
    ),
    'stale'
  )
  assert.equal(stale.calls.some((call) => call.url.includes('/reviews')), false)
})

test('returns without publishing findings that do not map to changed lines', async () => {
  const { github, calls } = createService()
  const result = await github.publishPullRequestFindings(
    'user-1',
    'owner/repository',
    7,
    pullRequest.head.sha,
    'review-1',
    findings,
    { 'src/app.ts': [3] }
  )
  assert.equal(result, 'no-inline-findings')
  assert.equal(calls.some((call) => call.url.includes('/reviews')), false)
})

test('propagates GitHub comment publishing failures for worker retry', async () => {
  const { github } = createService({ failPost: true })
  await assert.rejects(
    github.publishPullRequestFindings(
      'user-1',
      'owner/repository',
      7,
      pullRequest.head.sha,
      'review-1',
      findings,
      { 'src/app.ts': [10, 11] }
    ),
    /GitHub API rate limit/
  )
})

test('disconnect revokes OAuth when configured and removes the local credential', async () => {
  const previousId = env.GITHUB_CLIENT_ID
  const previousSecret = env.GITHUB_CLIENT_SECRET
  env.GITHUB_CLIENT_ID = 'mock-client-id'
  env.GITHUB_CLIENT_SECRET = 'mock-client-secret'
  let removed = false
  let revokeRequest: { url: string; data: string; username?: string; password?: string } | null = null
  const api = axios.create({
    adapter: async (config) => {
      revokeRequest = {
        url: config.url ?? '',
        data: String(config.data),
        username: config.auth?.username,
        password: config.auth?.password,
      }
      return { data: '', status: 204, statusText: 'No Content', headers: {}, config }
    },
  })
  const github = new GitHubService(api, undefined, {
    async findCredential() {
      return { id: 'account-1', accessToken: encrypt('mock-github-token') }
    },
    async removeCredential(userId, accountId) {
      assert.equal(userId, 'user-1')
      assert.equal(accountId, 'account-1')
      removed = true
    },
  })

  try {
    assert.deepEqual(await github.disconnectAccount('user-1'), { providerRevoked: true })
    assert.equal(removed, true)
    assert.ok(revokeRequest)
    assert.match(revokeRequest.url, /\/applications\/mock-client-id\/grant$/)
    assert.equal(revokeRequest.username, 'mock-client-id')
    assert.equal(revokeRequest.password, 'mock-client-secret')
    assert.match(revokeRequest.data, /mock-github-token/)
  } finally {
    env.GITHUB_CLIENT_ID = previousId
    env.GITHUB_CLIENT_SECRET = previousSecret
  }
})

test('disconnect removes local credential even when GitHub revocation fails', async () => {
  const previousId = env.GITHUB_CLIENT_ID
  const previousSecret = env.GITHUB_CLIENT_SECRET
  env.GITHUB_CLIENT_ID = 'mock-client-id'
  env.GITHUB_CLIENT_SECRET = 'mock-client-secret'
  let removed = false
  const api = axios.create({
    adapter: async () => {
      throw new Error('mock provider failure')
    },
  })
  const github = new GitHubService(api, undefined, {
    async findCredential() {
      return { id: 'account-1', accessToken: encrypt('mock-github-token') }
    },
    async removeCredential() {
      removed = true
    },
  })

  try {
    assert.deepEqual(await github.disconnectAccount('user-1'), { providerRevoked: false })
    assert.equal(removed, true)
  } finally {
    env.GITHUB_CLIENT_ID = previousId
    env.GITHUB_CLIENT_SECRET = previousSecret
  }
})
