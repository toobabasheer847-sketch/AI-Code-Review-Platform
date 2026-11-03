import type { Request, Response } from 'express';
import logger from '@/utils/logger';
import {
  DuplicateCandidateReviewNotFoundError,
  DuplicateCandidateService,
} from './duplicate-candidates.service';

const duplicateCandidateService = new DuplicateCandidateService();

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export class DuplicateCandidateController {
  constructor(
    private readonly service: Pick<DuplicateCandidateService, 'listForReview'> = duplicateCandidateService
  ) {}

  async list(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const report = await this.service.listForReview(req.user.userId, routeParam(req.params.id));
      res.json(report);
    } catch (error) {
      if (error instanceof DuplicateCandidateReviewNotFoundError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Duplicate candidate request failed'
      );
      res.status(500).json({ error: 'Unable to load duplicate candidates.' });
    }
  }
}
