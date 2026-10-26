import { Router } from 'express'
import { authMiddleware } from '@/middleware/auth.middleware'
import { ReviewController } from './review.controller'
import { ReviewAnalyticsController } from './review-analytics.controller'

const router = Router()
const controller = new ReviewController()
const analyticsController = new ReviewAnalyticsController()

router.get('/', authMiddleware, (req, res) => controller.listReviews(req, res))
router.get('/analytics', authMiddleware, (req, res) =>
  analyticsController.get(req, res)
)
router.post('/start', authMiddleware, (req, res) => controller.startReview(req, res))
router.patch('/findings/:findingId/status', authMiddleware, (req, res) =>
  controller.updateFindingStatus(req, res)
)
router.post('/findings/:findingId/fix-proposals', authMiddleware, (req, res) =>
  controller.createFixProposal(req, res)
)
router.post(
  '/fix-proposals/:proposalId/verification-attempts',
  authMiddleware,
  (req, res) => controller.verifyFixProposal(req, res)
)
router.post('/findings/:findingId/verification-requests', authMiddleware, (req, res) =>
  controller.requestFindingVerification(req, res)
)
router.get(
  '/findings/:findingId/verification-requests/:requestKey',
  authMiddleware,
  (req, res) => controller.getFindingVerification(req, res)
)
router.get('/:id', authMiddleware, (req, res) => controller.getReview(req, res))
router.delete('/:id', authMiddleware, (req, res) => controller.deleteReview(req, res))

export default router
