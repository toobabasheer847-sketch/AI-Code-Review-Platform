import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { AuthController } from './auth.controller'
import { authMiddleware } from '@/middleware/auth.middleware'

const router = Router()
const authController = new AuthController()
export const accountActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many account security requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Public routes
router.post('/register', (req, res) => authController.register(req, res))
router.post('/login', (req, res) => authController.login(req, res))
router.post('/verify-email', accountActionLimiter, (req, res) =>
  authController.verifyEmail(req, res)
)
router.post('/password-reset/request', accountActionLimiter, (req, res) =>
  authController.requestPasswordReset(req, res)
)
router.post('/password-reset/confirm', accountActionLimiter, (req, res) =>
  authController.resetPassword(req, res)
)

// Protected routes
router.post('/logout', authMiddleware, (req, res) => authController.logout(req, res))
router.get('/me', authMiddleware, (req, res) => authController.getCurrentUser(req, res))
router.post('/verification-email', authMiddleware, accountActionLimiter, (req, res) =>
  authController.resendVerificationEmail(req, res)
)
router.delete('/account', authMiddleware, accountActionLimiter, (req, res) =>
  authController.deleteAccount(req, res)
)

export default router
