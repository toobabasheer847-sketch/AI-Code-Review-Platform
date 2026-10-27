import type { Request, Response } from 'express'
import { ReviewNotFoundError, ReviewService } from './review.service'
import logger from '@/utils/logger'
import {
  generateTestSuggestions,
  TestGenerationError,
  type TestGenerationProvider,
} from './test-generator'

export interface TestGenerationReviewService {
  getReview(userId: string, reviewId: string): Promise<{
    fileContent: string
    findings: Array<{
      id: string
      file: string
      line: number
      title: string | null
      message: string
      evidence: string | null
      suggestions: string[]
    }>
  }>
}

export class TestGenerationController {
  constructor(
    private readonly reviews: Pick<ReviewService, 'getReview'> | TestGenerationReviewService =
      new ReviewService(),
    private readonly generate: typeof generateTestSuggestions = generateTestSuggestions,
    private readonly provider?: TestGenerationProvider
  ) {}

  async generateForFinding(req: Request, res: Response): Promise<void> {
    const userId = req.user?.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    try {
      const review = await this.reviews.getReview(userId, req.params.id)
      const finding = review.findings.find(({ id }) => id === req.params.findingId)
      if (!finding) {
        res.status(404).json({ error: 'Review or finding not found.' })
        return
      }
      const result = this.provider
        ? await this.generate(
            review.fileContent,
            { ...finding, findingId: finding.id },
            this.provider
          )
        : await this.generate(review.fileContent, { ...finding, findingId: finding.id })
      res.json({ result })
    } catch (error) {
      if (error instanceof ReviewNotFoundError) {
        res.status(404).json({ error: 'Review or finding not found.' })
        return
      }
      if (error instanceof TestGenerationError) {
        const status =
          error.kind === 'unsupported_language'
            ? 400
            : error.kind === 'timeout'
              ? 504
              : 502
        res.status(status).json({ error: error.message })
        return
      }
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Test suggestion generation failed'
      )
      res.status(500).json({ error: 'Unable to generate test suggestions.' })
    }
  }
}
