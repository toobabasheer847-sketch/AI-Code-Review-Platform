import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '@/middleware/auth.middleware';
import { AutomationController } from './automation.controller';

const router = Router();
const controller = new AutomationController();
const createLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many automation planning requests. Try again shortly.' },
});

router.use(authMiddleware);
router.get('/', (req, res) => controller.list(req, res));
router.post('/', createLimiter, (req, res) => controller.create(req, res));
router.get('/:id', (req, res) => controller.get(req, res));
router.post('/:id/approve', (req, res) => controller.approve(req, res));
router.post('/:id/reject', (req, res) => controller.reject(req, res));
router.post('/:id/cancel', (req, res) => controller.cancel(req, res));
router.post('/:id/retry', (req, res) => controller.retry(req, res));

export default router;
