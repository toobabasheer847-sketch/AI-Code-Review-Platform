import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { GitHubController } from './github.controller'
import { authMiddleware } from '@/middleware/auth.middleware'

const router = Router()
const controller = new GitHubController()

const githubLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many GitHub requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
})

router.get('/connect', authMiddleware, githubLimiter, (req, res) => controller.connect(req, res))
router.delete('/disconnect', authMiddleware, githubLimiter, (req, res) =>
  controller.disconnect(req, res)
)
router.get('/callback', githubLimiter, (req, res) => controller.callback(req, res))
router.get('/repos', authMiddleware, githubLimiter, (req, res) => controller.getRepos(req, res))
router.get('/repos/:owner/:repo/files', authMiddleware, githubLimiter, (req, res) => controller.getRepoFiles(req, res))
router.get('/repos/:repoName/files', authMiddleware, githubLimiter, (req, res) => controller.getRepoFiles(req, res))
router.get('/file', authMiddleware, githubLimiter, (req, res) => controller.getFileContent(req, res))

export default router
