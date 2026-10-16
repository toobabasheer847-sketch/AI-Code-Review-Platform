import type { Request, Response } from 'express';
import { z } from 'zod';
import logger from '@/utils/logger';
import { AutomationError } from '@/modules/automation/automation.domain';
import { GitHubIntegrationError, InvalidReviewTargetError } from './github.service';
import {
  GITHUB_DEVELOPMENT_TEMPLATES,
  GitHubDevelopmentService,
} from './github-development.service';

const templateIds = GITHUB_DEVELOPMENT_TEMPLATES.map((template) => template.id) as [
  (typeof GITHUB_DEVELOPMENT_TEMPLATES)[number]['id'],
  ...(typeof GITHUB_DEVELOPMENT_TEMPLATES)[number]['id'][],
];
const createWorkflowSchema = z
  .object({
    template: z.enum(templateIds),
    repository: z.string().trim().min(3).max(200),
    pullRequestNumber: z.number().int().positive().max(2_147_483_647).optional(),
    issueTitle: z.string().trim().min(1).max(256).optional(),
    issueBody: z.string().trim().min(1).max(10_000).optional(),
    commentBody: z.string().trim().min(1).max(10_000).optional(),
  })
  .strict();

const service = new GitHubDevelopmentService();

export class GitHubDevelopmentController {
  templates(_req: Request, res: Response): void {
    res.json(GITHUB_DEVELOPMENT_TEMPLATES);
  }

  async createWorkflow(req: Request, res: Response): Promise<void> {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = createWorkflowSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid GitHub development workflow request.' });
      return;
    }
    const idempotencyKey = req.get('Idempotency-Key');
    if (idempotencyKey && (idempotencyKey.length > 100 || idempotencyKey.trim().length === 0)) {
      res.status(400).json({ error: 'Invalid Idempotency-Key header.' });
      return;
    }
    try {
      const workflow = await service.createWorkflow(userId, {
        ...parsed.data,
        idempotencyKey,
      });
      res.status(201).json(workflow);
    } catch (error) {
      if (error instanceof AutomationError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      if (error instanceof InvalidReviewTargetError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      if (error instanceof GitHubIntegrationError) {
        const statusCode =
          error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 404
            ? error.statusCode
            : error.statusCode === 429
              ? 429
              : 502;
        res.status(statusCode).json({
          error: error.message,
          ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        });
        return;
      }
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'GitHub development workflow creation failed'
      );
      res.status(500).json({ error: 'Unable to create the GitHub development workflow.' });
    }
  }
}
