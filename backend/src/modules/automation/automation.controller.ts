import { AutomationMode } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';
import logger from '@/utils/logger';
import { AutomationError, MAX_AUTOMATION_GOAL_LENGTH } from './automation.domain';
import { VisualWorkflowValidationError } from './visual-workflow.domain';
import { AutomationService } from './automation.service';

const service = new AutomationService();
const createSchema = z.object({
  goal: z.string().trim().min(1).max(MAX_AUTOMATION_GOAL_LENGTH),
  mode: z.nativeEnum(AutomationMode).default(AutomationMode.APPROVAL_REQUIRED),
});
const visualWorkflowRequestSchema = z
  .object({
    goal: z.string().trim().min(1).max(MAX_AUTOMATION_GOAL_LENGTH),
    workflow: z.unknown(),
  })
  .strict();

export class AutomationController {
  async validateVisual(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = visualWorkflowRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide a goal and a visual workflow definition.' });
      return;
    }
    try {
      res.json(await service.validateVisualWorkflow(req.user.userId, parsed.data.workflow));
    } catch (error) {
      this.respondError(res, error);
    }
  }

  async saveVisual(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = visualWorkflowRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide a goal and a visual workflow definition.' });
      return;
    }
    try {
      res
        .status(201)
        .json(
          await service.saveVisualDraft(req.user.userId, parsed.data.goal, parsed.data.workflow)
        );
    } catch (error) {
      this.respondError(res, error);
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Provide a goal up to 2,000 characters and a supported mode.' });
      return;
    }
    const idempotencyKey = req.get('Idempotency-Key');
    if (idempotencyKey && (idempotencyKey.length > 100 || idempotencyKey.trim().length === 0)) {
      res.status(400).json({ error: 'Invalid Idempotency-Key header.' });
      return;
    }
    try {
      const automation = await service.create(req.user.userId, {
        ...parsed.data,
        idempotencyKey,
      });
      res.status(201).json(automation);
    } catch (error) {
      this.respondError(res, error);
    }
  }

  async list(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      res.json(await service.list(req.user.userId));
    } catch (error) {
      this.respondError(res, error);
    }
  }

  async get(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const automation = await service.get(req.user.userId, req.params.id);
      if (!automation) {
        res.status(404).json({ error: 'Automation not found.' });
        return;
      }
      res.json(automation);
    } catch (error) {
      this.respondError(res, error);
    }
  }

  async approve(req: Request, res: Response): Promise<void> {
    await this.perform(req, res, (userId, id) => service.approve(userId, id));
  }

  async reject(req: Request, res: Response): Promise<void> {
    await this.perform(req, res, (userId, id) => service.reject(userId, id));
  }

  async cancel(req: Request, res: Response): Promise<void> {
    await this.perform(req, res, (userId, id) => service.cancel(userId, id));
  }

  async retry(req: Request, res: Response): Promise<void> {
    await this.perform(req, res, (userId, id) => service.retry(userId, id));
  }

  async executeDraft(req: Request, res: Response): Promise<void> {
    await this.perform(req, res, (userId, id) => service.executeVisualDraft(userId, id));
  }

  private async perform(
    req: Request,
    res: Response,
    operation: (userId: string, id: string) => Promise<unknown>
  ): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      res.json(await operation(req.user.userId, req.params.id));
    } catch (error) {
      this.respondError(res, error);
    }
  }

  private respondError(res: Response, error: unknown): void {
    if (error instanceof VisualWorkflowValidationError) {
      res.status(400).json({ error: 'The visual workflow is invalid.', issues: error.issues });
      return;
    }
    if (error instanceof AutomationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error(
      { errorType: error instanceof Error ? error.name : 'UnknownError' },
      'Automation request failed'
    );
    res.status(500).json({ error: 'Unable to process automation request.' });
  }
}
