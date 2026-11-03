import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth.middleware';
import { RepositoryController } from './repository.controller';

const router = Router();
const controller = new RepositoryController();

router.use(authMiddleware);
router.get('/', (req, res) => controller.list(req, res));
router.get('/:repositoryId/review-rules', (req, res) => controller.listRules(req, res));
router.post('/:repositoryId/review-rules', (req, res) => controller.createRule(req, res));
router.patch('/:repositoryId/review-rules/:ruleId', (req, res) => controller.updateRule(req, res));
router.delete('/:repositoryId/review-rules/:ruleId', (req, res) => controller.deleteRule(req, res));

export default router;
