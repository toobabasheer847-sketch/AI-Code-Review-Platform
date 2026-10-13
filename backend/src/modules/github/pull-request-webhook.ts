import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { ReviewQuotaExceededError } from '@/modules/billing/review-quota'
import {
  InvalidReviewTargetError,
  type GitHubService,
  type PullRequestReviewTarget,
} from './github.service'

const relevantActions = new Set(['opened', 'synchronize', 'reopened'])

const pullRequestPayloadSchema = z.object({
  action: z.string().min(1).max(100),
  repository: z.object({
    full_name: z.string().min(3).max(300),
    html_url: z.string().url(),
  }),
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({ sha: z.string().regex(/^[\da-f]{40}$/i) }),
  }),
})

export interface PullRequestDeliveryInput {
  deliveryId: string
  event: 'pull_request'
  action: string
  repositoryFullName: string
  pullRequestNumber: number
  headSha: string
  repositoryUrl: string
}

export interface AuthorizedRepository {
  id: string
  userId: string
  name: string
  url: string
}

export interface PullRequestReviewReservation {
  reviewId: string
  status: string
  shouldQueue: boolean
}

export interface PullRequestWebhookStore {
  claimDelivery(input: PullRequestDeliveryInput): Promise<boolean>
  findAuthorizedRepositories(repositoryUrl: string): Promise<AuthorizedRepository[]>
  createOrGetReview(
    deliveryId: string,
    repository: AuthorizedRepository,
    target: PullRequestReviewTarget
  ): Promise<PullRequestReviewReservation>
  setDeliveryStatus(
    deliveryId: string,
    status: string,
    errorMessage?: string
  ): Promise<void>
  failQueuedReview(deliveryId: string, reviewId: string, message: string): Promise<void>
}

export interface PullRequestWebhookQueue {
  add(
    name: string,
    data: { reviewId: string },
    options: { jobId: string }
  ): Promise<unknown>
  getJob(jobId: string): Promise<{
    getState(): Promise<string>
    remove(): Promise<void>
  } | null | undefined>
}

export interface PullRequestWebhookDependencies {
  secret: string
  store: PullRequestWebhookStore
  github: Pick<GitHubService, 'fetchPullRequestTarget'>
  queue: PullRequestWebhookQueue
}

export type PullRequestWebhookResult =
  | { status: 'ignored'; reason: string }
  | { status: 'duplicate' }
  | { status: 'queued'; reviewId: string }
  | { status: 'already-processed'; reviewId: string }
  | { status: 'quota-exceeded' }

export class WebhookRequestError extends Error {
  readonly statusCode = 400

  constructor(message: string) {
    super(message)
    this.name = 'WebhookRequestError'
  }
}

export function verifyGitHubWebhookSignature(
  body: Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !/^sha256=[\da-f]{64}$/i.test(signature) || !secret) return false
  const expected = createHmac('sha256', secret).update(body).digest()
  const supplied = Buffer.from(signature.slice('sha256='.length), 'hex')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function parsePayload(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8')) as unknown
  } catch {
    throw new WebhookRequestError('Webhook payload must be valid JSON')
  }
}

export class PullRequestWebhookService {
  constructor(private readonly dependencies: PullRequestWebhookDependencies) {}

  async handle(
    body: Buffer,
    headers: {
      signature?: string
      event?: string
      delivery?: string
    }
  ): Promise<PullRequestWebhookResult> {
    if (!Buffer.isBuffer(body)) {
      throw new WebhookRequestError('Webhook payload must be sent as application/json')
    }
    if (!verifyGitHubWebhookSignature(body, headers.signature, this.dependencies.secret)) {
      throw new WebhookRequestError('Invalid GitHub webhook signature')
    }

    const payload = parsePayload(body)
    if (headers.event !== 'pull_request') {
      return { status: 'ignored', reason: 'Unsupported GitHub event' }
    }

    const parsed = pullRequestPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      throw new WebhookRequestError('Malformed pull request webhook payload')
    }
    if (!relevantActions.has(parsed.data.action)) {
      return { status: 'ignored', reason: 'Unsupported pull request action' }
    }
    if (
      !headers.delivery ||
      !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
        headers.delivery
      )
    ) {
      throw new WebhookRequestError('Missing or invalid GitHub delivery ID')
    }

    const repositoryFullName = parsed.data.repository.full_name
    const delivery: PullRequestDeliveryInput = {
      deliveryId: headers.delivery,
      event: 'pull_request',
      action: parsed.data.action,
      repositoryFullName,
      pullRequestNumber: parsed.data.pull_request.number,
      headSha: parsed.data.pull_request.head.sha,
      repositoryUrl: `https://github.com/${repositoryFullName}`,
    }

    if (!(await this.dependencies.store.claimDelivery(delivery))) {
      return { status: 'duplicate' }
    }

    try {
      const candidates = await this.dependencies.store.findAuthorizedRepositories(
        delivery.repositoryUrl
      )
      let authorized:
        | { repository: AuthorizedRepository; target: PullRequestReviewTarget }
        | undefined
      for (const repository of candidates) {
        try {
          const target = await this.dependencies.github.fetchPullRequestTarget(
            repository.userId,
            repositoryFullName,
            delivery.pullRequestNumber
          )
          if (target.headSha !== delivery.headSha) continue
          authorized = { repository, target }
          break
        } catch (error) {
          if (error instanceof InvalidReviewTargetError) {
            continue
          }
          throw error
        }
      }

      if (!authorized) {
        await this.dependencies.store.setDeliveryStatus(
          delivery.deliveryId,
          'unauthorized',
          'No connected user has an authorized repository and pull request'
        )
        return { status: 'ignored', reason: 'Repository authorization could not be verified' }
      }

      const reservation = await this.dependencies.store.createOrGetReview(
        delivery.deliveryId,
        authorized.repository,
        authorized.target
      )
      if (!reservation.shouldQueue) {
        await this.dependencies.store.setDeliveryStatus(
          delivery.deliveryId,
          reservation.status === 'completed' ? 'completed' : 'already-processed'
        )
        return { status: 'already-processed', reviewId: reservation.reviewId }
      }

      try {
        const jobId = `review-${reservation.reviewId}`
        const existingJob = await this.dependencies.queue.getJob(jobId)
        if (existingJob && (await existingJob.getState()) === 'failed') {
          await existingJob.remove()
        }
        await this.dependencies.queue.add(
          'analyze',
          { reviewId: reservation.reviewId },
          { jobId }
        )
      } catch (error) {
        await this.dependencies.store.failQueuedReview(
          delivery.deliveryId,
          reservation.reviewId,
          'Queue unavailable'
        )
        throw error
      }

      await this.dependencies.store.setDeliveryStatus(delivery.deliveryId, 'queued')
      return { status: 'queued', reviewId: reservation.reviewId }
    } catch (error) {
      if (error instanceof ReviewQuotaExceededError) {
        await this.dependencies.store.setDeliveryStatus(delivery.deliveryId, 'quota-exceeded')
        return { status: 'quota-exceeded' }
      }
      await this.dependencies.store.setDeliveryStatus(
        delivery.deliveryId,
        'failed',
        'Pull request webhook processing failed'
      )
      throw error
    }
  }
}
