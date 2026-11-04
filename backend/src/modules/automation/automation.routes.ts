import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth.middleware';
import { automationLimiter, automationUserLimiter } from '@/middleware/rate-limit';
import { AutomationController } from './automation.controller';

const router = Router();
const controller = new AutomationController();
const createLimiter = [automationLimiter, automationUserLimiter];

router.use(authMiddleware);
router.get('/schedules', (req, res) => controller.schedules(req, res));
router.post('/schedules', ...createLimiter, (req, res) => controller.createSchedule(req, res));
router.patch('/schedules/:id', (req, res) => controller.updateSchedule(req, res));
router.get('/notification-preferences', (req, res) => controller.notificationPreferences(req, res));
router.put('/notification-preferences', (req, res) => controller.notificationPreferences(req, res));
router.post('/schedules/:id/pause', (req, res) => controller.pauseSchedule(req, res));
router.post('/schedules/:id/resume', (req, res) => controller.resumeSchedule(req, res));
router.delete('/schedules/:id', (req, res) => controller.cancelSchedule(req, res));
router.post('/visual/validate', ...createLimiter, (req, res) =>
  controller.validateVisual(req, res)
);
router.post('/visual', ...createLimiter, (req, res) => controller.saveVisual(req, res));
router.get('/', (req, res) => controller.list(req, res));
router.post('/', ...createLimiter, (req, res) => controller.create(req, res));
router.post('/:id/execute-draft', ...createLimiter, (req, res) =>
  controller.executeDraft(req, res)
);
router.get('/:id', (req, res) => controller.get(req, res));
router.post('/:id/approve', (req, res) => controller.approve(req, res));
router.post('/:id/reject', (req, res) => controller.reject(req, res));
router.post('/:id/cancel', (req, res) => controller.cancel(req, res));
router.post('/:id/retry', ...createLimiter, (req, res) => controller.retry(req, res));

export default router;
