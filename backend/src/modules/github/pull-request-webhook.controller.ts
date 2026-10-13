import { Request, Response } from 'express'
import { env } from '@/config/env'
import logger from '@/utils/logger'
import { reviewQueue } from '@/jobs/review.queue'
import { GitHubService } from './github.service'
import {
  PullRequestWebhookService,
  WebhookRequestError,
} from './pull-request-webhook'
import { pullRequestWebhookStore } from './pull-request-webhook.store'

const webhookService = new PullRequestWebhookService({
  secret: env.GITHUB_WEBHOOK_SECRET,
  store: pullRequestWebhookStore,
  github: new GitHubService(),
  queue: reviewQueue,
})

export class PullRequestWebhookController {
  async receive(req: Request, res: Response): Promise<void> {
    try {
      const result = await webhookService.handle(req.body, {
        signature: req.get('x-hub-signature-256'),
        event: req.get('x-github-event'),
        delivery: req.get('x-github-delivery'),
      })
      res.status(result.status === 'queued' || result.status === 'duplicate' ? 202 : 200).json(result)
    } catch (error) {
      if (error instanceof WebhookRequestError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      logger.error('GitHub pull request webhook processing failed')
      res.status(500).json({ error: 'GitHub webhook processing failed' })
    }
  }
}
