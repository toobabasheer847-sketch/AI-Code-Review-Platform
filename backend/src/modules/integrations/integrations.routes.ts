import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth.middleware';
import { integrationLimiter } from '@/middleware/rate-limit';
import { IntegrationsController } from './integrations.controller';
import { optionalWorkspacePermission } from '@/modules/workspaces/workspace-access.middleware';

const router = Router();
const controller = new IntegrationsController();

router.use(authMiddleware, integrationLimiter);
router.get('/', optionalWorkspacePermission('read'), (req, res) => controller.list(req, res));
router.post('/:provider/check', optionalWorkspacePermission('manage_integrations'), (req, res) => controller.check(req, res));

export default router;
