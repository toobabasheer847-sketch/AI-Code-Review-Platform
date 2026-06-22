import { Router } from 'express'
import { authMiddleware } from '@/middleware/auth.middleware'
import { ReviewController } from './review.controller'

const router = Router()
const controller = new ReviewController()

router.get('/', authMiddleware, (req, res) => controller.listReviews(req, res))
router.post('/start', authMiddleware, (req, res) => controller.startReview(req, res))
router.get('/:id', authMiddleware, (req, res) => controller.getReview(req, res))
router.delete('/:id', authMiddleware, (req, res) => controller.deleteReview(req, res))

export default router
