import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth.middleware';
import { receiveVerificationCallback } from './fix-verification.callback';
import { ReviewController } from './review.controller';
import { ReviewAnalyticsController } from './review-analytics.controller';
import { FeedbackAnalyticsController } from './feedback-analytics.controller';
import { DuplicateCandidateController } from './duplicate-candidates.controller';
import { TestGenerationController } from './test-generation.controller';
import { aiGenerationLimiter, manualReviewLimiter } from '@/middleware/rate-limit';

const router = Router();
const controller = new ReviewController();
const analyticsController = new ReviewAnalyticsController();
const feedbackAnalyticsController = new FeedbackAnalyticsController();
const duplicateCandidateController = new DuplicateCandidateController();
const testGenerationController = new TestGenerationController();

router.get('/', authMiddleware, (req, res) => controller.listReviews(req, res));
router.get('/analytics', authMiddleware, (req, res) => analyticsController.get(req, res));
router.get('/feedback-analytics', authMiddleware, (req, res) =>
  feedbackAnalyticsController.get(req, res)
);
router.post('/start', authMiddleware, manualReviewLimiter, (req, res) =>
  controller.startReview(req, res)
);
router.post('/findings/:findingId/feedback', authMiddleware, (req, res) =>
  controller.submitFindingFeedback(req, res)
);
router.get('/fix-verification-attempts', authMiddleware, (req, res) =>
  controller.listFixVerifications(req, res)
);
router.get('/fix-verification-attempts/:attemptId', authMiddleware, (req, res) =>
  controller.getFixVerificationEvidence(req, res)
);
router.post('/fix-verification-attempts/:attemptId/review-decision', authMiddleware, (req, res) =>
  controller.submitFixVerificationReview(req, res)
);
router.post('/fix-verification-attempts/:attemptId/cancel', authMiddleware, (req, res) =>
  controller.cancelFixVerification(req, res)
);
router.post('/internal/verification-callback', (req, res) => {
  void receiveVerificationCallback(req, res);
});
router.post(
  '/:id/findings/:findingId/test-suggestions',
  authMiddleware,
  aiGenerationLimiter,
  (req, res) => testGenerationController.generateForFinding(req, res)
);
router.patch('/findings/:findingId/status', authMiddleware, (req, res) =>
  controller.updateFindingStatus(req, res)
);
router.post('/findings/:findingId/fix-proposals', authMiddleware, (req, res) =>
  controller.createFixProposal(req, res)
);
router.post('/fix-proposals/:proposalId/verification-attempts', authMiddleware, (req, res) =>
  controller.verifyFixProposal(req, res)
);
router.post('/findings/:findingId/verification-requests', authMiddleware, (req, res) =>
  controller.requestFindingVerification(req, res)
);
router.get('/findings/:findingId/verification-requests/:requestKey', authMiddleware, (req, res) =>
  controller.getFindingVerification(req, res)
);
router.get('/:id/duplicate-candidates', authMiddleware, (req, res) =>
  duplicateCandidateController.list(req, res)
);
router.get('/:id', authMiddleware, (req, res) => controller.getReview(req, res));
router.delete('/:id', authMiddleware, (req, res) => controller.deleteReview(req, res));

export default router;
