import { WorkMemorySource, WorkMemoryType } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';
import logger from '@/utils/logger';
import { MAX_MEMORY_CONTENT_LENGTH } from './memory.domain';
import { WorkMemoryError, WorkMemoryService } from './memory.service';

const memorySchema = z.object({
  type: z.nativeEnum(WorkMemoryType),
  source: z.nativeEnum(WorkMemorySource),
  sourceLabel: z.string().trim().min(1).max(160),
  sourceId: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1).max(MAX_MEMORY_CONTENT_LENGTH),
  repositoryId: z.string().trim().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export class WorkMemoryController {
  constructor(private readonly service = new WorkMemoryService()) {}

  async list(req: Request, res: Response): Promise<void> {
    await this.run(req, res, (userId) => this.service.list(userId));
  }

  async projects(req: Request, res: Response): Promise<void> {
    await this.run(req, res, (userId) => this.service.projects(userId));
  }

  async settings(req: Request, res: Response): Promise<void> {
    await this.run(req, res, (userId) => this.service.getSettings(userId));
  }

  async updateSettings(req: Request, res: Response): Promise<void> {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide an enabled boolean.' });
      return;
    }
    await this.run(req, res, (userId) => this.service.setEnabled(userId, parsed.data.enabled));
  }

  async create(req: Request, res: Response): Promise<void> {
    const parsed = memorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide valid, attributed memory details.' });
      return;
    }
    await this.run(req, res, (userId) => this.service.create(userId, parsed.data), 201);
  }

  async update(req: Request, res: Response): Promise<void> {
    const parsed = memorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide valid, attributed memory details.' });
      return;
    }
    await this.run(req, res, (userId) => this.service.update(userId, req.params.id, parsed.data));
  }

  async delete(req: Request, res: Response): Promise<void> {
    await this.run(req, res, async (userId) => {
      await this.service.delete(userId, req.params.id);
      res.status(204).end();
      return undefined;
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
      if (error instanceof WorkMemoryError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Work memory request failed'
      );
      res.status(500).json({ error: 'Unable to process work memory request.' });
    }
  }
}
