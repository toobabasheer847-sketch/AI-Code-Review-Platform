import { Router, type RequestHandler } from 'express'

import { authMiddleware } from '@/middleware/auth.middleware'

import { BetaController } from './beta.controller'
import { BetaService } from './beta.service'

export function createBetaRouter(
  authenticate: RequestHandler = authMiddleware,
  service = new BetaService()
): Router {
  const router = Router()
  const controller = new BetaController(service)
  router.use(authenticate)
  router.get('/guide', (req, res) => controller.guide(req, res))
  router.post('/onboarding/dismiss', (req, res) => controller.dismiss(req, res))
  router.get('/feedback', (req, res) => controller.list(req, res))
  router.post('/feedback', (req, res) => controller.submit(req, res))
  router.get('/admin/overview', (req, res) => controller.overview(req, res))
  router.patch('/admin/feedback/:id', (req, res) => controller.updateStatus(req, res))
  router.patch('/admin/users/:id', (req, res) => controller.setAccess(req, res))
  return router
}

export default createBetaRouter()
