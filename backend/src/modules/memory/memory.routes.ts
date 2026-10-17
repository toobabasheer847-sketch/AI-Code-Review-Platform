import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth.middleware';
import { WorkMemoryController } from './memory.controller';

const router = Router();
const controller = new WorkMemoryController();

router.use(authMiddleware);
router.get('/settings', (req, res) => controller.settings(req, res));
router.patch('/settings', (req, res) => controller.updateSettings(req, res));
router.get('/projects', (req, res) => controller.projects(req, res));
router.get('/', (req, res) => controller.list(req, res));
router.post('/', (req, res) => controller.create(req, res));
router.patch('/:id', (req, res) => controller.update(req, res));
router.delete('/:id', (req, res) => controller.delete(req, res));

export default router;
