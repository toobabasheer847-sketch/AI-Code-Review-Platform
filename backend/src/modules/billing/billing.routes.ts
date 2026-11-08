import { Router } from 'express'
import { BillingController } from './billing.controller'
import { authMiddleware } from '@/middleware/auth.middleware'
import { optionalWorkspacePermission } from '@/modules/workspaces/workspace-access.middleware'

const router = Router()
const controller = new BillingController()

router.post('/create-checkout', authMiddleware, optionalWorkspacePermission('manage_billing'), (req, res) => controller.createCheckout(req, res))
router.post('/cancel-subscription', authMiddleware, optionalWorkspacePermission('manage_billing'), (req, res) => controller.cancelSubscription(req, res))
router.post('/webhook', (req, res) => controller.webhook(req, res))
router.get('/subscription', authMiddleware, optionalWorkspacePermission('view_billing'), (req, res) => controller.getSubscription(req, res))
router.get('/usage', authMiddleware, optionalWorkspacePermission('view_billing'), (req, res) => controller.getUsage(req, res))

export default router
