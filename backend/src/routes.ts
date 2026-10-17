import { Router } from 'express'
import authRoutes from '@/modules/auth/auth.routes'
import githubRoutes from '@/modules/github/github.routes'
import reviewRoutes from '@/modules/code-review/review.routes'
import billingRoutes from '@/modules/billing/billing.routes'
import chatRoutes from '@/modules/chat/chat.routes'
import pullRequestWebhookRoutes from '@/modules/github/pull-request-webhook.routes'
import automationRoutes from '@/modules/automation/automation.routes'
import socialRoutes from '@/modules/social/social.routes'
import workMemoryRoutes from '@/modules/memory/memory.routes'
import integrationsRoutes from '@/modules/integrations/integrations.routes'

/**
 * Aggregates all API routes.
 * Only the routes backed by implemented controllers/services are mounted here.
 */
export const createApiRoutes = (): Router => {
  const router = Router()

  router.use('/auth', authRoutes)
  router.use('/github', githubRoutes)
  router.use('/auth/github', githubRoutes)
  router.use('/reviews', reviewRoutes)
  router.use('/billing', billingRoutes)
  router.use('/chat', chatRoutes)
  router.use('/automations', automationRoutes)
  router.use('/social', socialRoutes)
  router.use('/memory', workMemoryRoutes)
  router.use('/integrations', integrationsRoutes)
  router.use('/webhooks/github', pullRequestWebhookRoutes)

  return router
}

export default createApiRoutes
