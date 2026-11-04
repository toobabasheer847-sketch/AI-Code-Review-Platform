import { Router } from 'express';
import { AuthController } from './auth.controller';
import { accountLifecycleAuthMiddleware } from '@/middleware/auth.middleware';
import { accountSecurityLimiter, emailVerificationLimiter } from '@/middleware/rate-limit';

const router = Router();
const authController = new AuthController();
export const accountActionLimiter = accountSecurityLimiter;
export const verificationAttemptLimiter = emailVerificationLimiter;

// Public routes
router.get('/csrf', (req, res) => authController.getCsrfToken(req, res));
router.post('/register', (req, res) => authController.register(req, res));
router.post('/login', (req, res) => authController.login(req, res));
router.post('/verification-email/request', accountActionLimiter, (req, res) =>
  authController.requestEmailVerification(req, res)
);
router.post('/verify-email', verificationAttemptLimiter, (req, res) =>
  authController.verifyEmail(req, res)
);
router.post('/password-reset/request', accountActionLimiter, (req, res) =>
  authController.requestPasswordReset(req, res)
);
router.post('/password-reset/confirm', accountActionLimiter, (req, res) =>
  authController.resetPassword(req, res)
);

// Protected routes
router.post('/logout', accountLifecycleAuthMiddleware, (req, res) =>
  authController.logout(req, res)
);
router.get('/me', accountLifecycleAuthMiddleware, (req, res) =>
  authController.getCurrentUser(req, res)
);
router.post(
  '/verification-email',
  accountLifecycleAuthMiddleware,
  accountActionLimiter,
  (req, res) => authController.resendVerificationEmail(req, res)
);
router.delete('/account', accountLifecycleAuthMiddleware, accountActionLimiter, (req, res) =>
  authController.deleteAccount(req, res)
);

export default router;
