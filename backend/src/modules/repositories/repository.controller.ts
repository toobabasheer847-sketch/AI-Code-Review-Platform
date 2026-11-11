import type { Request, Response } from 'express';
import { prisma } from '@/config/database';
import { getPersonalWorkspaceId } from '@/modules/workspaces/workspace.service';
import logger from '@/utils/logger';
import {
  InvalidRepositoryReviewRuleError,
  RepositoryNotFoundError,
  RepositoryReviewRuleLimitError,
  RepositoryReviewRuleNotFoundError,
  RepositoryReviewRuleService,
} from './repository-review-rules.service';

const repositoryReviewRuleService = new RepositoryReviewRuleService();

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export class RepositoryController {
  constructor(
    private readonly rules: Pick<
      RepositoryReviewRuleService,
      'list' | 'create' | 'update' | 'remove'
    > = repositoryReviewRuleService
  ) {}

  async list(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const workspaceId = await getPersonalWorkspaceId(req.user.userId);
      const repositories = await prisma.repository.findMany({
        where: { userId: req.user.userId, workspaceId },
        select: { id: true, name: true, url: true, language: true, createdAt: true },
        orderBy: { name: 'asc' },
        take: 200,
      });
      res.json({ repositories });
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Repository list failed'
      );
      res.status(500).json({ error: 'Unable to list repositories.' });
    }
  }

  async listRules(req: Request, res: Response): Promise<void> {
    await this.run(req, res, (userId) =>
      this.rules.list(userId, routeParam(req.params.repositoryId)).then((rules) => ({ rules }))
    );
  }

  async createRule(req: Request, res: Response): Promise<void> {
    await this.run(
      req,
      res,
      (userId) =>
        this.rules
          .create(userId, routeParam(req.params.repositoryId), req.body)
          .then((rule) => ({ rule })),
      201
    );
  }

  async updateRule(req: Request, res: Response): Promise<void> {
    await this.run(req, res, (userId) =>
      this.rules
        .update(
          userId,
          routeParam(req.params.repositoryId),
          routeParam(req.params.ruleId),
          req.body
        )
        .then((rule) => ({ rule }))
    );
  }

  async deleteRule(req: Request, res: Response): Promise<void> {
    await this.run(req, res, async (userId) => {
      await this.rules.remove(
        userId,
        routeParam(req.params.repositoryId),
        routeParam(req.params.ruleId)
      );
      res.status(204).end();
    });
  }

  private async run(
    req: Request,
    res: Response,
    operation: (userId: string) => Promise<unknown>,
    statusCode = 200
  ): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const result = await operation(req.user.userId);
      if (!res.headersSent) res.status(statusCode).json(result);
    } catch (error) {
      if (
        error instanceof RepositoryNotFoundError ||
        error instanceof RepositoryReviewRuleNotFoundError ||
        error instanceof InvalidRepositoryReviewRuleError ||
        error instanceof RepositoryReviewRuleLimitError
      ) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Repository request failed'
      );
      res.status(500).json({ error: 'Unable to update repository review rules.' });
    }
  }
}
