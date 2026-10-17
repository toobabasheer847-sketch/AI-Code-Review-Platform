import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '@/middleware/auth.middleware';
import { IntegrationsController } from './integrations.controller';

const router = Router();
const controller = new IntegrationsController();
const integrationLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many integration requests. Try again shortly.' },
});

router.use(authMiddleware, integrationLimiter);
router.get('/', (req, res) => controller.list(req, res));
router.post('/:provider/check', (req, res) => controller.check(req, res));

export default router;
