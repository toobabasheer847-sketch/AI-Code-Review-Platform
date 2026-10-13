import { Router } from 'express'
import authRoutes from '@/modules/auth/auth.routes'
import githubRoutes from '@/modules/github/github.routes'
import reviewRoutes from '@/modules/code-review/review.routes'
import billingRoutes from '@/modules/billing/billing.routes'
import chatRoutes from '@/modules/chat/chat.routes'

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

  return router
}

export default createApiRoutes
