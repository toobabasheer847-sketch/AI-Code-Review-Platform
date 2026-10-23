import { Request, Response } from 'express'
import { ZodError, z } from 'zod'
import { ReviewNotFoundError, ReviewService } from './review.service'
import { updateFindingStatusSchema } from './finding-lifecycle.domain'
import { FindingLifecycleService } from './finding-lifecycle.service'
import { FixProposalService } from './fix-verification.service'

const reviewService = new ReviewService()
const findingLifecycleService = new FindingLifecycleService()
const fixProposalService = new FixProposalService()
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
    typeof error.statusCode === 'number'
  ) {
    return error.statusCode
  }
  return 500
}

export class ReviewController {
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
			const message = error instanceof Error ? error.message : 'Unable to update finding status'
			res.status(getErrorStatus(error)).json({ error: message })
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
			const message = error instanceof Error ? error.message : 'Unable to save fix proposal'
			res.status(getErrorStatus(error)).json({ error: message })
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
			const message = error instanceof Error ? error.message : 'Failed to list reviews'
			res.status(getErrorStatus(error)).json({ error: message })
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
			const message = error instanceof Error ? error.message : 'Failed to fetch review'
			res.status(getErrorStatus(error)).json({ error: message })
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
			const message = error instanceof Error ? error.message : 'Failed to delete review'
			res.status(getErrorStatus(error)).json({ error: message })
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
			const message = error instanceof Error ? error.message : 'Failed to start review'
			res.status(getErrorStatus(error)).json({ error: message })
		}
	}
}
