import { Router } from 'express'
import { BillingController } from './billing.controller'
import { authMiddleware } from '@/middleware/auth.middleware'

const router = Router()
const controller = new BillingController()

router.post('/create-checkout', authMiddleware, (req, res) => controller.createCheckout(req, res))
router.post('/cancel-subscription', authMiddleware, (req, res) => controller.cancelSubscription(req, res))
router.post('/webhook', (req, res) => controller.webhook(req, res))
router.get('/subscription', authMiddleware, (req, res) => controller.getSubscription(req, res))
router.get('/usage', authMiddleware, (req, res) => controller.getUsage(req, res))

export default router
