import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth.middleware';
import { automationLimiter, automationUserLimiter } from '@/middleware/rate-limit';
import { AutomationController } from './automation.controller';
import { optionalWorkspacePermission } from '@/modules/workspaces/workspace-access.middleware';

const router = Router();
const controller = new AutomationController();
const createLimiter = [automationLimiter, automationUserLimiter];

router.use(authMiddleware);
router.get('/schedules', optionalWorkspacePermission('read'), (req, res) => controller.schedules(req, res));
router.post('/schedules', optionalWorkspacePermission('create_automation'), ...createLimiter, (req, res) => controller.createSchedule(req, res));
router.patch('/schedules/:id', optionalWorkspacePermission('create_automation'), (req, res) => controller.updateSchedule(req, res));
router.get('/notification-preferences', (req, res) => controller.notificationPreferences(req, res));
router.put('/notification-preferences', (req, res) => controller.notificationPreferences(req, res));
router.post('/schedules/:id/pause', optionalWorkspacePermission('create_automation'), (req, res) => controller.pauseSchedule(req, res));
router.post('/schedules/:id/resume', optionalWorkspacePermission('create_automation'), (req, res) => controller.resumeSchedule(req, res));
router.delete('/schedules/:id', optionalWorkspacePermission('create_automation'), (req, res) => controller.cancelSchedule(req, res));
router.post('/visual/validate', optionalWorkspacePermission('create_automation'), ...createLimiter, (req, res) =>
  controller.validateVisual(req, res)
);
router.post('/visual', optionalWorkspacePermission('create_automation'), ...createLimiter, (req, res) => controller.saveVisual(req, res));
router.get('/', optionalWorkspacePermission('read'), (req, res) => controller.list(req, res));
router.post('/', optionalWorkspacePermission('create_automation'), ...createLimiter, (req, res) => controller.create(req, res));
router.post('/:id/execute-draft', optionalWorkspacePermission('approve_automation'), ...createLimiter, (req, res) =>
  controller.executeDraft(req, res)
);
router.get('/:id', optionalWorkspacePermission('read'), (req, res) => controller.get(req, res));
router.post('/:id/approve', optionalWorkspacePermission('approve_automation'), (req, res) => controller.approve(req, res));
router.post('/:id/reject', optionalWorkspacePermission('approve_automation'), (req, res) => controller.reject(req, res));
router.post('/:id/cancel', optionalWorkspacePermission('create_automation'), (req, res) => controller.cancel(req, res));
router.post('/:id/retry', optionalWorkspacePermission('create_automation'), ...createLimiter, (req, res) => controller.retry(req, res));

export default router;
