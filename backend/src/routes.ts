import { Router } from 'express'
import chatRoutes from '@/modules/chat/chat.routes'
import reviewRoutes from '@/modules/code-review/review.routes'
import billingRoutes from '@/modules/billing/billing.routes'

/**
 * Aggregates all API routes
 * This file serves as the central point for route registration
 */

export const createApiRoutes = (): Router => {
  const router = Router()

  // Health endpoint (not behind /api)
  // Handled in app.ts

  /**
   * Auth routes
   * POST /api/auth/login
   * POST /api/auth/register
   * POST /api/auth/logout
   * POST /api/auth/refresh
   */
  // router.use('/auth', authRoutes)

  /**
   * User routes
   * GET /api/users/:id
   * PUT /api/users/:id
   * DELETE /api/users/:id
   */
  // router.use('/users', userRoutes)

  /**
   * Repository routes
   * GET /api/repositories
   * POST /api/repositories
   * GET /api/repositories/:id
   * PUT /api/repositories/:id
   * DELETE /api/repositories/:id
   */
  // router.use('/repositories', repositoryRoutes)

  /**
   * Code review routes
   * GET /api/reviews
   * POST /api/reviews
   * GET /api/reviews/:id
   * PUT /api/reviews/:id
   */
  router.use('/reviews', reviewRoutes)
  router.use('/billing', billingRoutes)

  /**
   * GitHub routes
   * POST /api/github/webhook
   * GET /api/github/repositories
   */
  // router.use('/github', githubRoutes)

  /**
   * Billing routes
   * GET /api/billing/plans
   * POST /api/billing/subscribe
   * GET /api/billing/subscription
   */
  // router.use('/billing', billingRoutes)

  /**
   * Chat routes
   * WebSocket: /socket.io
   * REST endpoints for chat history
   */
  router.use('/chat', chatRoutes)

  return router
}

export default createApiRoutes
