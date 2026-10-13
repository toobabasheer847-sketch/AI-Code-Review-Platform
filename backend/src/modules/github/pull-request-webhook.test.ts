import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import {
  getAddedPullRequestLines,
  InvalidReviewTargetError,
  type GitHubService,
  type PullRequestReviewTarget,
} from './github.service'
import {
  PullRequestWebhookService,
  type AuthorizedRepository,
  type PullRequestReviewReservation,
  type PullRequestWebhookQueue,
  type PullRequestWebhookStore,
  verifyGitHubWebhookSignature,
} from './pull-request-webhook'

const secret = 'test-only-webhook-secret'
const repository: AuthorizedRepository = {
  id: 'repository-1',
  userId: 'user-1',
  name: 'owner/repository',
  url: 'https://github.com/owner/repository',
}
const target: PullRequestReviewTarget = {
  fullName: 'owner/repository',
  htmlUrl: 'https://github.com/owner/repository/pull/7',
  number: 7,
  headSha: 'a'.repeat(40),
  baseBranch: 'main',
  headBranch: 'feature',
}

function createPayload(action = 'opened'): Buffer {
  return Buffer.from(
    JSON.stringify({
      action,
      repository: {
        full_name: repository.name,
        html_url: repository.url,
      },
      pull_request: {
        number: target.number,
        head: { sha: target.headSha },
      },
    })
  )
}

function signature(body: Buffer, key = secret): string {
  return `sha256=${createHmac('sha256', key).update(body).digest('hex')}`
}

function createHarness(options: {
  alreadyClaimed?: boolean
  repositories?: AuthorizedRepository[]
  targetError?: Error
  queueError?: Error
} = {}) {
  const calls = {
    claim: 0,
    queue: 0,
    failQueue: 0,
    statuses: [] as string[],
    jobIds: [] as string[],
  }
  const store: PullRequestWebhookStore = {
    async claimDelivery() {
      calls.claim += 1
      return !options.alreadyClaimed
    },
    async findAuthorizedRepositories() {
      return options.repositories ?? [repository]
    },
    async createOrGetReview(): Promise<PullRequestReviewReservation> {
      return { reviewId: 'review-1', status: 'pending', shouldQueue: true }
    },
    async setDeliveryStatus(_deliveryId, status) {
      calls.statuses.push(status)
    },
    async failQueuedReview() {
      calls.failQueue += 1
    },
  }
  const github = {
    async fetchPullRequestTarget(userId: string, fullName: string, number: number) {
      assert.equal(userId, repository.userId)
      assert.equal(fullName, target.fullName)
      assert.equal(number, target.number)
      if (options.targetError) throw options.targetError
      return target
    },
  } as Pick<GitHubService, 'fetchPullRequestTarget'>
  const queue: PullRequestWebhookQueue = {
    async getJob() {
      return undefined
    },
    async add(_name, _data, jobOptions) {
      calls.queue += 1
      calls.jobIds.push(jobOptions.jobId)
      if (options.queueError) throw options.queueError
    },
  }

  return {
    calls,
    store,
    service: new PullRequestWebhookService({ secret, store, github, queue }),
  }
}

test('verifies GitHub webhook HMAC signatures and rejects invalid signatures', () => {
  const body = createPayload()
  assert.equal(verifyGitHubWebhookSignature(body, signature(body), secret), true)
  assert.equal(verifyGitHubWebhookSignature(body, signature(body, 'wrong'), secret), false)
  assert.equal(verifyGitHubWebhookSignature(body, 'sha1=deadbeef', secret), false)
  assert.equal(verifyGitHubWebhookSignature(body, undefined, secret), false)
})

test('rejects invalid signatures and malformed signed payloads', async () => {
  const { service } = createHarness()
  const body = createPayload()
  await assert.rejects(
    service.handle(body, {
      signature: signature(body, 'incorrect'),
      event: 'pull_request',
      delivery: '00000000-0000-4000-8000-000000000007',
    }),
    /Invalid GitHub webhook signature/
  )

  const malformed = Buffer.from('{')
  await assert.rejects(
    service.handle(malformed, {
      signature: signature(malformed),
      event: 'pull_request',
      delivery: '00000000-0000-4000-8000-000000000007',
    }),
    /valid JSON/
  )
})

test('ignores unsupported GitHub events and pull request actions', async () => {
  const { service, calls } = createHarness()
  const body = createPayload('closed')

  assert.deepEqual(
    await service.handle(body, {
      signature: signature(body),
      event: 'pull_request',
      delivery: '00000000-0000-4000-8000-000000000007',
    }),
    { status: 'ignored', reason: 'Unsupported pull request action' }
  )
  assert.deepEqual(
    await service.handle(body, {
      signature: signature(body),
      event: 'issues',
      delivery: '00000000-0000-4000-8000-000000000007',
    }),
    { status: 'ignored', reason: 'Unsupported GitHub event' }
  )
  assert.equal(calls.claim, 0)
  assert.equal(calls.queue, 0)
})

test('queues a supported pull request delivery using its verified repository and commit', async () => {
  const { service, calls } = createHarness()
  const body = createPayload('synchronize')
  const result = await service.handle(body, {
    signature: signature(body),
    event: 'pull_request',
    delivery: '00000000-0000-4000-8000-000000000007',
  })

  assert.deepEqual(result, { status: 'queued', reviewId: 'review-1' })
  assert.equal(calls.claim, 1)
  assert.equal(calls.queue, 1)
  assert.deepEqual(calls.statuses, ['queued'])
})

test('does not queue duplicate deliveries or repositories without an authorized owner', async () => {
  const duplicate = createHarness({ alreadyClaimed: true })
  const body = createPayload()
  assert.deepEqual(
    await duplicate.service.handle(body, {
      signature: signature(body),
      event: 'pull_request',
      delivery: '00000000-0000-4000-8000-000000000007',
    }),
    { status: 'duplicate' }
  )
  assert.equal(duplicate.calls.queue, 0)

  const unauthorized = createHarness({ repositories: [] })
  assert.deepEqual(
    await unauthorized.service.handle(body, {
      signature: signature(body),
      event: 'pull_request',
      delivery: '00000000-0000-4000-8000-000000000008',
    }),
    { status: 'ignored', reason: 'Repository authorization could not be verified' }
  )
  assert.deepEqual(unauthorized.calls.statuses, ['unauthorized'])
  assert.equal(unauthorized.calls.queue, 0)
})

test('marks queue failures and does not return a queued result', async () => {
  const { service, calls } = createHarness({ queueError: new Error('Redis unavailable') })
  const body = createPayload()
  await assert.rejects(
    service.handle(body, {
      signature: signature(body),
      event: 'pull_request',
      delivery: '00000000-0000-4000-8000-000000000009',
    }),
    /Redis unavailable/
  )
  assert.equal(calls.failQueue, 1)
  assert.deepEqual(calls.statuses, ['failed'])
})

test('only maps added diff lines and safely rejects a changed head', () => {
  assert.deepEqual(
    getAddedPullRequestLines(
      '@@ -2,3 +2,4 @@\n unchanged\n-removed\n+added\n+also added\n\\ No newline'
    ),
    [3, 4]
  )
  assert.deepEqual(getAddedPullRequestLines(undefined), [])
})

test('tries another repository owner when a linked token cannot access the pull request', async () => {
  const secondRepository = { ...repository, id: 'repository-2', userId: 'user-2' }
  const harness = createHarness({ repositories: [repository, secondRepository] })
  let attempts = 0
  const github = {
    async fetchPullRequestTarget(userId: string) {
      attempts += 1
      if (userId === repository.userId) {
        throw new InvalidReviewTargetError('No access')
      }
      return target
    },
  } as Pick<GitHubService, 'fetchPullRequestTarget'>
  const service = new PullRequestWebhookService({
    secret,
    store: harness.store,
    github,
    queue: {
      async getJob() {
        return undefined
      },
      async add() {
        harness.calls.queue += 1
      },
    },
  })
  const body = createPayload()

  assert.deepEqual(
    await service.handle(body, {
      signature: signature(body),
      event: 'pull_request',
      delivery: '00000000-0000-4000-8000-000000000010',
    }),
    { status: 'queued', reviewId: 'review-1' }
  )
  assert.equal(attempts, 2)
  assert.equal(harness.calls.queue, 1)
})
