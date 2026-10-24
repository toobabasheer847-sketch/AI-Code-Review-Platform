import assert from 'node:assert/strict'
import test from 'node:test'
import type { AxiosInstance } from 'axios'
import { GitHubService } from './github.service'

test('pins manual review source retrieval to the resolved Git commit', async () => {
  const sourceRevision = 'c'.repeat(40)
  const requests: Array<{ url: string; config?: { params?: Record<string, string> } }> = []
  const api = {
    async get(url: string, config?: { params?: Record<string, string> }) {
      requests.push({ url, config })
      if (url.endsWith('/commits/feature/review')) {
        return { data: { sha: sourceRevision } }
      }
      if (url.endsWith(`/git/trees/${sourceRevision}`)) {
        return {
          data: {
            truncated: false,
            tree: [{ path: 'src/index.ts', type: 'blob', size: 21, sha: 'file-sha' }],
          },
        }
      }
      if (url.endsWith('/contents/src/index.ts')) {
        return { data: 'export const result = 42' }
      }
      throw new Error('Unexpected GitHub request')
    },
  } as unknown as AxiosInstance
  const service = new GitHubService(api, async () => 'synthetic-test-token')

  const files = await service.fetchReviewFiles('user-1', 'owner/repository', 'feature/review')

  assert.equal(files.length, 1)
  assert.equal(files[0]?.sourceRevision, sourceRevision)
  assert.ok(requests.some((request) => request.url.endsWith(`/git/trees/${sourceRevision}`)))
  assert.ok(
    requests.some(
      (request) =>
        request.url.endsWith('/contents/src/index.ts') &&
        request.config?.params?.ref === sourceRevision
    )
  )
})

test('rejects an invalid commit revision before fetching review source', async () => {
  let requestCount = 0
  const api = {
    async get() {
      requestCount += 1
      return { data: { sha: 'not-a-commit' } }
    },
  } as unknown as AxiosInstance
  const service = new GitHubService(api, async () => 'synthetic-test-token')

  await assert.rejects(
    service.fetchReviewFiles('user-1', 'owner/repository', 'main'),
    /invalid source revision/
  )
  assert.equal(requestCount, 1)
})
