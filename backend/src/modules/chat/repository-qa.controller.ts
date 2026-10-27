import axios from 'axios';
import type { Request, Response } from 'express';
import {
  GitHubIntegrationError,
  GitHubService,
  InvalidReviewTargetError,
} from '@/modules/github/github.service';
import logger from '@/utils/logger';
import { RepositoryQAError, RepositoryQAService } from './repository-qa.service';
import { repositoryQuestionSchema } from './chat.validation';

const githubService = new GitHubService();

export class RepositoryQAController {
  constructor(
    private readonly qa: RepositoryQAService = new RepositoryQAService(
      (userId, repository, branch) => githubService.fetchReviewFiles(userId, repository, branch)
    )
  ) {}

  async ask(req: Request, res: Response): Promise<void> {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = repositoryQuestionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid repository question.' });
      return;
    }

    try {
      res.status(200).json(await this.qa.ask(userId, parsed.data));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const remainingRequests = String(error.response?.headers['x-ratelimit-remaining'] ?? '');
        if (status === 429 || (status === 403 && remainingRequests === '0')) {
          res
            .status(429)
            .json({ error: 'GitHub rate limit reached. Retry the repository question later.' });
          return;
        }
        if (status === 403 || status === 404) {
          res.status(status).json({
            error:
              status === 403
                ? 'The connected GitHub account cannot access this repository.'
                : 'The repository or requested branch was not found or is not accessible.',
          });
          return;
        }
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          res.status(504).json({ error: 'GitHub source retrieval timed out. Retry later.' });
          return;
        }
      }
      if (error instanceof GitHubIntegrationError || error instanceof InvalidReviewTargetError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      if (error instanceof RepositoryQAError) {
        const status = error.kind === 'rate_limited' ? 429 : error.kind === 'timeout' ? 504 : 502;
        res.status(status).json({ error: error.message });
        return;
      }
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Repository question failed'
      );
      res.status(502).json({ error: 'Unable to answer the repository question right now.' });
    }
  }
}
