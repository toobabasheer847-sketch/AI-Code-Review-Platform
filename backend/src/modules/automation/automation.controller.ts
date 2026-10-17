import { AutomationMode } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';
import logger from '@/utils/logger';
import { AutomationError, MAX_AUTOMATION_GOAL_LENGTH } from './automation.domain';
import { VisualWorkflowValidationError } from './visual-workflow.domain';
import { AutomationService } from './automation.service';
import { AutomationScheduleService } from './automation-schedule.service';
import { AutomationScheduleFrequency, AutomationScheduleStatus } from '@prisma/client';

const service = new AutomationService();
const scheduleService = new AutomationScheduleService(service);
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
const scheduleSchema = z
  .object({
    automationId: z.string().cuid(),
    frequency: z.nativeEnum(AutomationScheduleFrequency),
    timeZone: z.string().min(1).max(100),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
  })
  .strict();
const scheduleUpdateSchema = scheduleSchema.omit({ automationId: true });
const notificationPreferenceSchema = z
  .object({
    failureNotifications: z.boolean(),
    repeatedFailureThreshold: z.number().int().min(2).max(10),
    dailySummaryEnabled: z.boolean(),
    dailySummaryTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    dailySummaryTimeZone: z.string().min(1).max(100),
  })
  .strict();

export class AutomationController {
  async schedules(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      res.json(await scheduleService.list(req.user.userId));
    } catch (error) {
      this.respondError(res, error);
    }
  }

  async createSchedule(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide a saved workflow, valid timezone, frequency, and local run time.' });
      return;
    }
    try {
      res.status(201).json(await scheduleService.create(req.user.userId, parsed.data));
    } catch (error) {
      this.respondError(res, error);
    }
  }

  async pauseSchedule(req: Request, res: Response): Promise<void> {
    await this.performScheduleStatus(req, res, AutomationScheduleStatus.PAUSED);
  }

  async resumeSchedule(req: Request, res: Response): Promise<void> {
    await this.performScheduleStatus(req, res, AutomationScheduleStatus.ACTIVE);
  }

  async cancelSchedule(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      res.json(await scheduleService.cancel(req.user.userId, req.params.id));
    } catch (error) {
      this.respondError(res, error);
    }
  }

  async updateSchedule(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = scheduleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide a valid timezone, frequency, and local run time.' });
      return;
    }
    try {
      res.json(await scheduleService.update(req.user.userId, req.params.id, parsed.data));
    } catch (error) {
      this.respondError(res, error);
    }
  }

  async notificationPreferences(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      if (req.method === 'GET') {
        res.json(await scheduleService.getNotificationPreferences(req.user.userId));
        return;
      }
      const parsed = notificationPreferenceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Notification preferences are invalid.' });
        return;
      }
      res.json(await scheduleService.updateNotificationPreferences(req.user.userId, parsed.data));
    } catch (error) {
      this.respondError(res, error);
    }
  }

  private async performScheduleStatus(
    req: Request,
    res: Response,
    status: 'PAUSED' | 'ACTIVE'
  ): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      res.json(await scheduleService.setStatus(req.user.userId, req.params.id, status));
    } catch (error) {
      this.respondError(res, error);
    }
  }

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
