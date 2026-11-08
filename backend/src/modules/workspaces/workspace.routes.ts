import { Router } from 'express'
import { authMiddleware } from '@/middleware/auth.middleware'
import { workspaceInvitationEmailLimiter } from '@/middleware/rate-limit'
import {
  requireWorkspacePermission,
  workspaceAccessMiddleware,
} from './workspace-access.middleware'
import { WorkspaceController } from './workspace.controller'

const router = Router()
const controller = new WorkspaceController()

router.use(authMiddleware)
router.get('/', (req, res) => controller.list(req, res))
router.post('/', (req, res) => controller.create(req, res))
router.post('/organizations/:organizationId/workspaces', (req, res) =>
  controller.createInOrganization(req, res)
)
router.post('/invitations/accept', (req, res) => controller.acceptInvitation(req, res))

router.get(
  '/:workspaceId/members',
  workspaceAccessMiddleware,
  requireWorkspacePermission('read'),
  (req, res) => controller.members(req, res)
)
router.get(
  '/:workspaceId/invitations',
  workspaceAccessMiddleware,
  requireWorkspacePermission('manage_members'),
  (req, res) => controller.invitations(req, res)
)
router.get(
  '/:workspaceId/repositories',
  workspaceAccessMiddleware,
  requireWorkspacePermission('read'),
  (req, res) => controller.repositories(req, res)
)
router.get(
  '/:workspaceId/billing',
  workspaceAccessMiddleware,
  requireWorkspacePermission('view_billing'),
  (req, res) => controller.billing(req, res)
)
router.get(
  '/:workspaceId/reviews',
  workspaceAccessMiddleware,
  requireWorkspacePermission('read'),
  (req, res) => controller.reviews(req, res)
)
router.post(
  '/:workspaceId/reviews/start',
  workspaceAccessMiddleware,
  requireWorkspacePermission('start_review'),
  (req, res) => controller.startReview(req, res)
)
router.get(
  '/:workspaceId/reviews/:reviewId',
  workspaceAccessMiddleware,
  requireWorkspacePermission('read'),
  (req, res) => controller.review(req, res)
)
router.patch(
  '/:workspaceId/findings/:findingId/status',
  workspaceAccessMiddleware,
  requireWorkspacePermission('update_findings'),
  (req, res) => controller.updateFindingStatus(req, res)
)
router.post(
  '/:workspaceId/invitations',
  workspaceAccessMiddleware,
  requireWorkspacePermission('manage_members'),
  workspaceInvitationEmailLimiter,
  (req, res) => controller.invite(req, res)
)
router.post(
  '/:workspaceId/invitations/:invitationId/resend',
  workspaceAccessMiddleware,
  requireWorkspacePermission('manage_members'),
  workspaceInvitationEmailLimiter,
  (req, res) => controller.resendInvitation(req, res)
)
router.delete(
  '/:workspaceId/invitations/:invitationId',
  workspaceAccessMiddleware,
  requireWorkspacePermission('manage_members'),
  (req, res) => controller.revokeInvitation(req, res)
)
router.patch(
  '/:workspaceId/members/:membershipId',
  workspaceAccessMiddleware,
  requireWorkspacePermission('manage_members'),
  (req, res) => controller.updateMember(req, res)
)
router.delete(
  '/:workspaceId/members/:membershipId',
  workspaceAccessMiddleware,
  requireWorkspacePermission('manage_members'),
  (req, res) => controller.removeMember(req, res)
)
router.post(
  '/:workspaceId/transfer-ownership',
  workspaceAccessMiddleware,
  requireWorkspacePermission('transfer_ownership'),
  (req, res) => controller.transferOwnership(req, res)
)
router.patch(
  '/:workspaceId',
  workspaceAccessMiddleware,
  requireWorkspacePermission('manage_members'),
  (req, res) => controller.update(req, res)
)

export default router
