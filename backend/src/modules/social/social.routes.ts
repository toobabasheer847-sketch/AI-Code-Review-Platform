import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '@/middleware/auth.middleware';
import { SocialController } from './social.controller';

const router = Router();
const controller = new SocialController();
const socialLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many social publishing requests. Try again shortly.' },
});

router.get('/linkedin/callback', socialLimiter, (req, res) =>
  controller.linkedinCallback(req, res)
);
router.use(authMiddleware, socialLimiter);
router.get('/status', (req, res) => controller.status(req, res));
router.get('/posts', (req, res) => controller.posts(req, res));
router.post('/linkedin/connect', (req, res) => controller.connectLinkedIn(req, res));
router.delete('/accounts/:accountId', (req, res) => controller.disconnectAccount(req, res));
router.post('/drafts/generate', (req, res) => controller.generateDraft(req, res));
router.post('/drafts', (req, res) => controller.createDraft(req, res));
router.patch('/posts/:postId', (req, res) => controller.updatePost(req, res));
router.post('/posts/:postId/request-approval', (req, res) =>
  controller.requestApproval(req, res)
);
router.post('/posts/:postId/approve', (req, res) => controller.approve(req, res));
router.post('/posts/:postId/reject', (req, res) => controller.reject(req, res));
router.post('/posts/:postId/cancel', (req, res) => controller.cancel(req, res));
router.post('/posts/:postId/retry', (req, res) => controller.retry(req, res));

export default router;
