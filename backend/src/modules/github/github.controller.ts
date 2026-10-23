import crypto from 'crypto'
import { Request, Response } from 'express'
import { env } from '@/config/env'
import logger from '@/utils/logger'
import { GitHubIntegrationError, GitHubService, InvalidReviewTargetError } from './github.service'
import { decrypt, encrypt } from '@/utils/crypto'
import { isValidOAuthState } from '@/modules/integrations/oauth-state'

const githubService = new GitHubService()

function respondWithGitHubError(error: unknown, res: Response, fallback: string): void {
  if (error instanceof GitHubIntegrationError || error instanceof InvalidReviewTargetError) {
    const status =
      Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 502
    res.status(status).json({ error: error.message })
    return
  }

  if (error instanceof URIError) {
    res.status(400).json({ error: 'Invalid repository or file path.' })
    return
  }

  logger.error(
    { errorType: error instanceof Error ? error.name : 'UnknownError' },
    'GitHub request failed'
  )
  res.status(502).json({ error: fallback })
}

function parseCookieValue(cookieHeader: string | undefined, key: string): string | null {
  if (!cookieHeader) {
    return null
  }

  const cookie = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${key}=`))

  if (!cookie) {
    return null
  }

  return decodeURIComponent(cookie.split('=')[1])
}

export class GitHubController {
  async connect(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const state = crypto.randomBytes(32).toString('hex')
      const authorizeUrl = githubService.getAuthorizeUrl(state)

      res.cookie('github_oauth_state', state, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 5 * 60 * 1000,
      })
      res.cookie('github_oauth_user', encrypt(userId), {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 5 * 60 * 1000,
      })

      res.json({ url: authorizeUrl })
    } catch {
      res.status(500).json({ error: 'Failed to connect GitHub' })
    }
  }

  async callback(req: Request, res: Response): Promise<void> {
    res.clearCookie('github_oauth_state')
    res.clearCookie('github_oauth_user')
    try {
      const code = String(req.query.code || '')
      const state = String(req.query.state || '')
      const cookieState = parseCookieValue(req.headers.cookie, 'github_oauth_state')
      const cookieUser = parseCookieValue(req.headers.cookie, 'github_oauth_user')

      if (!code || !isValidOAuthState(state, cookieState) || !cookieUser) {
        res.status(400).json({ error: 'Invalid GitHub callback state' })
        return
      }

      const userId = decrypt(cookieUser)
      const authorization = await githubService.exchangeCodeForToken(code)
      const profile = await githubService.fetchGitHubProfile(authorization.accessToken)
      await githubService.saveGitHubAccount(
        userId,
        profile,
        authorization.accessToken,
        authorization.scopes
      )

      res.redirect(`${env.FRONTEND_URL}/github/repos?connected=true`)
    } catch {
      res.clearCookie('github_oauth_state')
      res.clearCookie('github_oauth_user')
      res.status(400).json({ error: 'GitHub authorization could not be completed' })
    }
  }

  async disconnect(req: Request, res: Response): Promise<void> {
    const userId = req.user?.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    try {
      const result = await githubService.disconnectAccount(userId)
      res.json({
        message: 'GitHub was disconnected. Reviews and repository records were retained.',
        providerRevoked: result.providerRevoked,
      })
    } catch {
      res.status(500).json({ error: 'Unable to disconnect GitHub' })
    }
  }

  async getRepos(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const repos = await githubService.getRepos(userId)
      res.json(repos)
    } catch (error) {
      respondWithGitHubError(error, res, 'Unable to fetch GitHub repositories.')
    }
  }

  async getRepoFiles(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId
      const repoName = req.params.owner && req.params.repo
        ? `${req.params.owner}/${req.params.repo}`
        : String(req.params.repoName || '')

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      if (!repoName) {
        res.status(400).json({ error: 'Repository name is required' })
        return
      }

      const files = await githubService.getRepoFiles(userId, decodeURIComponent(repoName))
      res.json(files)
    } catch (error) {
      respondWithGitHubError(error, res, 'Unable to fetch repository files.')
    }
  }

  async getFileContent(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId
      const repo = String(req.query.repo || '')
      const path = String(req.query.path || '')

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      if (!repo || !path) {
        res.status(400).json({ error: 'Repository and path are required' })
        return
      }

      const content = await githubService.getFileContent(userId, decodeURIComponent(repo), decodeURIComponent(path))
      res.json(content)
    } catch (error) {
      respondWithGitHubError(error, res, 'Unable to fetch file content.')
    }
  }
}
