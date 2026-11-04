import { Router } from 'express'
import { authMiddleware } from '@/middleware/auth.middleware'
import { AIUsageController } from './usage.controller'

const router = Router()
const controller = new AIUsageController()

router.get('/', authMiddleware, (req, res) => controller.get(req, res))

export default router
