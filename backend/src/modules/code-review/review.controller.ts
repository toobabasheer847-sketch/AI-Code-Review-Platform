import { Request, Response } from 'express'
import { ZodError, z } from 'zod'
import { ReviewNotFoundError, ReviewService } from './review.service'
import { updateFindingStatusSchema } from './finding-lifecycle.domain'
import { FindingLifecycleService } from './finding-lifecycle.service'
import {
	FixProposalService,
	FixVerificationService,
} from './fix-verification.service'
import {
	FindingVerificationService,
	requestFindingVerificationSchema,
} from './finding-verification.service'
import logger from '@/utils/logger'

const reviewService = new ReviewService()
const findingLifecycleService = new FindingLifecycleService()
const fixProposalService = new FixProposalService()
const findingVerificationService = new FindingVerificationService()
const verifyFixProposalSchema = z
	.object({
		requestKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
	})
	.strict()
const startReviewSchema = z.object({
  repository: z.string().min(3).max(300),
  branch: z.string().min(1).max(255).optional(),
})

function getErrorStatus(error: unknown): number {
  if (error instanceof ZodError) return 400
  if (error instanceof ReviewNotFoundError) return error.statusCode
  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode < 600
  ) {
    return error.statusCode
  }
  return 500
}

function respondWithError(error: unknown, res: Response, fallback: string): void {
  const status = getErrorStatus(error)
  if (status >= 500) {
    logger.error(
      { errorType: error instanceof Error ? error.name : 'UnknownError' },
      'Review request failed'
    )
  }
  const message =
    status >= 500 || error instanceof ZodError
      ? fallback
      : error instanceof Error
        ? error.message
        : fallback
  res.status(status).json({ error: message })
}

export class ReviewController {
	constructor(
		private readonly fixVerificationService: Pick<
			FixVerificationService,
			'verifyProposal'
		> = new FixVerificationService()
	) {}

	async updateFindingStatus(req: Request, res: Response): Promise<void> {
		if (!req.user?.userId) {
			res.status(401).json({ error: 'Unauthorized' })
			return
		}

		const parsed = updateFindingStatusSchema.safeParse(req.body)
		if (!parsed.success) {
			res.status(400).json({ error: 'Invalid finding status update.' })
			return
		}

		try {
			const feedback = await findingLifecycleService.updateStatus(
				req.user.userId,
				req.params.findingId,
				parsed.data.status,
				parsed.data.reason
			)
			res.json({ feedback })
		} catch (error) {
			respondWithError(error, res, 'Unable to update finding status.')
		}
	}

	async createFixProposal(req: Request, res: Response): Promise<void> {
		if (!req.user?.userId) {
			res.status(401).json({ error: 'Unauthorized' })
			return
		}

		try {
			const proposal = await fixProposalService.createProposal(
				req.user.userId,
				req.params.findingId,
				req.body
			)
			res.status(201).json({ proposal })
		} catch (error) {
			respondWithError(error, res, 'Unable to save fix proposal.')
		}
	}

	async verifyFixProposal(req: Request, res: Response): Promise<void> {
		if (!req.user?.userId) {
			res.status(401).json({ error: 'Unauthorized' })
			return
		}
		const parsed = verifyFixProposalSchema.safeParse(req.body)
		if (!parsed.success) {
			res.status(400).json({ error: 'Invalid fix verification request.' })
			return
		}

		try {
			const attempt = await this.fixVerificationService.verifyProposal(
				req.user.userId,
				req.params.proposalId,
				parsed.data.requestKey
			)
			res.json({ attempt })
		} catch (error) {
			respondWithError(error, res, 'Unable to verify this fix proposal.')
		}
	}

	async requestFindingVerification(req: Request, res: Response): Promise<void> {
		if (!req.user?.userId) {
			res.status(401).json({ error: 'Unauthorized' })
			return
		}
		const parsed = requestFindingVerificationSchema.safeParse(req.body)
		if (!parsed.success) {
			res.status(400).json({ error: 'Invalid verification request.' })
			return
		}

		try {
			const verification = await findingVerificationService.request(
				req.user.userId,
				req.params.findingId,
				parsed.data
			)
			res.json({ verification })
		} catch (error) {
			respondWithError(error, res, 'Unable to request independent verification.')
		}
	}

	async getFindingVerification(req: Request, res: Response): Promise<void> {
		if (!req.user?.userId) {
			res.status(401).json({ error: 'Unauthorized' })
			return
		}
		if (!/^[A-Za-z0-9._:-]{1,128}$/.test(req.params.requestKey)) {
			res.status(400).json({ error: 'Invalid verification request key.' })
			return
		}

		try {
			const verification = await findingVerificationService.get(
				req.user.userId,
				req.params.findingId,
				req.params.requestKey
			)
			res.json({ verification })
		} catch (error) {
			respondWithError(error, res, 'Unable to load independent verification.')
		}
	}

	async listReviews(req: Request, res: Response): Promise<void> {
		try {
			if (!req.user?.userId) {
				res.status(401).json({ error: 'Unauthorized' })
				return
			}

			const reviews = await reviewService.listReviews(req.user.userId)
			res.json(reviews)
		} catch (error) {
			respondWithError(error, res, 'Unable to list reviews.')
		}
	}

	async getReview(req: Request, res: Response): Promise<void> {
		try {
			if (!req.user?.userId) {
				res.status(401).json({ error: 'Unauthorized' })
				return
			}

			const reviewId = req.params.id
			const review = await reviewService.getReview(req.user.userId, reviewId)
			res.json(review)
		} catch (error) {
			respondWithError(error, res, 'Unable to load this review.')
		}
	}

	async deleteReview(req: Request, res: Response): Promise<void> {
		try {
			if (!req.user?.userId) {
				res.status(401).json({ error: 'Unauthorized' })
				return
			}

			const reviewId = req.params.id
			await reviewService.deleteReview(req.user.userId, reviewId)
			res.json({ message: 'Review deleted' })
		} catch (error) {
			respondWithError(error, res, 'Unable to delete this review.')
		}
	}

	async startReview(req: Request, res: Response): Promise<void> {
		try {
			if (!req.user?.userId) {
				res.status(401).json({ error: 'Unauthorized' })
				return
			}

			const { repository, branch } = startReviewSchema.parse(req.body)
			const review = await reviewService.startReview(
				req.user.userId,
				repository,
				branch || 'main'
			)
			res.json({ reviewId: review.id })
		} catch (error) {
			respondWithError(error, res, 'Unable to start this review.')
		}
	}
}
