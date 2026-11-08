import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth.middleware';
import { aiGenerationLimiter, socialLimiter } from '@/middleware/rate-limit';
import { SocialController } from './social.controller';
import { optionalWorkspacePermission } from '@/modules/workspaces/workspace-access.middleware';

const router = Router();
const controller = new SocialController();

router.get('/linkedin/callback', socialLimiter, (req, res) =>
  controller.linkedinCallback(req, res)
);
router.use(authMiddleware, socialLimiter);
router.get('/status', optionalWorkspacePermission('read'), (req, res) => controller.status(req, res));
router.get('/posts', optionalWorkspacePermission('read'), (req, res) => controller.posts(req, res));
router.post('/linkedin/connect', optionalWorkspacePermission('manage_integrations'), (req, res) => controller.connectLinkedIn(req, res));
router.delete('/accounts/:accountId', optionalWorkspacePermission('manage_integrations'), (req, res) => controller.disconnectAccount(req, res));
router.post('/drafts/generate', optionalWorkspacePermission('create_social_posts'), aiGenerationLimiter, (req, res) =>
  controller.generateDraft(req, res)
);
router.post('/drafts', optionalWorkspacePermission('create_social_posts'), (req, res) => controller.createDraft(req, res));
router.patch('/posts/:postId', optionalWorkspacePermission('create_social_posts'), (req, res) => controller.updatePost(req, res));
router.post('/posts/:postId/request-approval', optionalWorkspacePermission('create_social_posts'), (req, res) => controller.requestApproval(req, res));
router.post('/posts/:postId/approve', optionalWorkspacePermission('approve_social_posts'), (req, res) => controller.approve(req, res));
router.post('/posts/:postId/reject', optionalWorkspacePermission('approve_social_posts'), (req, res) => controller.reject(req, res));
router.post('/posts/:postId/cancel', optionalWorkspacePermission('create_social_posts'), (req, res) => controller.cancel(req, res));
router.post('/posts/:postId/retry', optionalWorkspacePermission('create_social_posts'), (req, res) => controller.retry(req, res));

export default router;
