import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth.middleware';
import { integrationLimiter } from '@/middleware/rate-limit';
import { IntegrationsController } from './integrations.controller';

const router = Router();
const controller = new IntegrationsController();

router.use(authMiddleware, integrationLimiter);
router.get('/', (req, res) => controller.list(req, res));
router.post('/:provider/check', (req, res) => controller.check(req, res));

export default router;
