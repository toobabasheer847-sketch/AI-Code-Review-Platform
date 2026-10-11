import { Request, Response } from 'express'
import { z } from 'zod'
import { ReviewService } from './review.service'

const reviewService = new ReviewService()
const startReviewSchema = z.object({
	repository: z.string().min(3).max(300),
	branch: z.string().min(1).max(255).optional(),
})

export class ReviewController {
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
			res.status(400).json({ error: message })
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
			res.status(400).json({ error: message })
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
			res.status(400).json({ error: message })
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
			const status =
				typeof error === 'object' &&
				error !== null &&
				'statusCode' in error &&
				typeof error.statusCode === 'number'
					? error.statusCode
					: 400
			res.status(status).json({ error: message })
		}
	}
}
