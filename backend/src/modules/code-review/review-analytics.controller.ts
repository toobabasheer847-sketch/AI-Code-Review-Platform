import type { Request, Response } from 'express';
import logger from '@/utils/logger';
import { ReviewAnalyticsFilterError } from './review-analytics.domain';
import {
  ReviewAnalyticsRepositoryNotFoundError,
  ReviewAnalyticsService,
} from './review-analytics.service';

const reviewAnalyticsService = new ReviewAnalyticsService();

export class ReviewAnalyticsController {
  constructor(
    private readonly service: Pick<ReviewAnalyticsService, 'get'> = reviewAnalyticsService
  ) {}

  async get(req: Request, res: Response): Promise<void> {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const analytics = await this.service.get(req.user.userId, req.query);
      res.json(analytics);
    } catch (error) {
      if (error instanceof ReviewAnalyticsRepositoryNotFoundError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      if (error instanceof ReviewAnalyticsFilterError) {
        res.status(400).json({ error: error.message });
        return;
      }
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Review analytics request failed'
      );
      res.status(500).json({ error: 'Unable to load review analytics.' });
    }
  }
}
