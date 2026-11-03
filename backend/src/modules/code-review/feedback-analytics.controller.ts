import type { Request, Response } from 'express';
import logger from '@/utils/logger';
import { ReviewAnalyticsFilterError } from './review-analytics.domain';
import {
  FeedbackAnalyticsRepositoryNotFoundError,
  FeedbackAnalyticsService,
} from './feedback-analytics.service';

const feedbackAnalyticsService = new FeedbackAnalyticsService();

export class FeedbackAnalyticsController {
  constructor(
    private readonly service: Pick<FeedbackAnalyticsService, 'get'> = feedbackAnalyticsService
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
      if (error instanceof FeedbackAnalyticsRepositoryNotFoundError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      if (error instanceof ReviewAnalyticsFilterError) {
        res.status(400).json({ error: error.message });
        return;
      }
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Feedback analytics request failed'
      );
      res.status(500).json({ error: 'Unable to load feedback analytics.' });
    }
  }
}
