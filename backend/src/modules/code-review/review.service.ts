import { prisma } from '@/config/database'
import { emailQueue } from '@/jobs/email.queue'
import { reviewQueue } from '@/jobs/review.queue'
import { GitHubService } from '@/modules/github/github.service'
import { releaseReviewQuota, reserveReviewQuota } from '@/modules/billing/review-quota'

export class ReviewService {
	private readonly githubService = new GitHubService()

	public async listReviews(userId: string) {
		const reviews = await prisma.codeReview.findMany({
			where: { userId },
			include: {
				repository: true,
				findings: true,
				analytics: true,
			},
			orderBy: { createdAt: 'desc' },
		})

		return reviews.map((r) => ({
			id: r.id,
			repository: r.repository.name,
			score: r.analytics?.qualityScore ?? null,
			issues: r.findings.length,
			status: r.status,
			createdAt: r.createdAt,
		}))
	}

	public async startReview(userId: string, repositoryName: string, branch = 'main') {
		const target = await this.githubService.validateReviewTarget(
			userId,
			repositoryName,
			branch
		)
		const review = await prisma.$transaction(async (transaction) => {
			await reserveReviewQuota(transaction, userId)
			const repository = await transaction.repository.upsert({
				where: { userId_url: { userId, url: target.htmlUrl } },
				create: { userId, name: target.fullName, url: target.htmlUrl },
				update: {},
			})

			return transaction.codeReview.create({
				data: {
					userId,
					repositoryId: repository.id,
					title: `Code review: ${target.fullName} (${branch})`,
					description: `Automated review for ${target.fullName} on branch ${branch}`,
					fileContent: '',
					branch,
					status: 'pending',
				},
			})
		})

		try {
			await reviewQueue.add(
				'analyze',
				{ reviewId: review.id },
				{ jobId: `review-${review.id}` }
			)
		} catch (error) {
			try {
				await prisma.$transaction(async (transaction) => {
					await transaction.codeReview.update({
						where: { id: review.id },
						data: {
							status: 'failed',
							errorMessage:
								error instanceof Error
									? `Unable to queue review: ${error.message}`.slice(0, 500)
									: 'Unable to queue review',
						},
					})
					await releaseReviewQuota(transaction, userId)
				})
			} catch (persistenceError) {
				throw new AggregateError(
					[error, persistenceError],
					'Unable to queue review and release its reserved quota'
				)
			}
			throw error
		}

		return review
	}

	public async getReview(userId: string, reviewId: string) {
		const review = await prisma.codeReview.findUnique({
			where: { id: reviewId },
			include: {
				repository: true,
				findings: true,
				analytics: true,
				chatConversation: {
					include: { messages: { orderBy: { createdAt: 'asc' } } },
				},
			},
		})

		if (!review) throw new Error('Review not found')
		if (review.userId !== userId) throw new Error('Unauthorized')

		return {
			id: review.id,
			repository: review.repository,
			title: review.title,
			description: review.description,
			fileContent: review.fileContent,
			findings: review.findings,
			analytics: review.analytics,
			chat: review.chatConversation,
			status: review.status,
			branch: review.branch,
			errorMessage: review.errorMessage,
			createdAt: review.createdAt,
		}
	}

	public async deleteReview(userId: string, reviewId: string) {
		const review = await prisma.codeReview.findUnique({ where: { id: reviewId } })
		if (!review) throw new Error('Review not found')
		if (review.userId !== userId) throw new Error('Unauthorized')

		await prisma.codeReview.delete({ where: { id: reviewId } })
	}

	public async sendReviewEmail(reviewId: string) {
		const review = await prisma.codeReview.findUnique({ where: { id: reviewId }, include: { repository: true, user: true, findings: true, analytics: true } })
		if (!review) throw new Error('Review not found')

		const to = review.user.email
		const payload = {
			to,
			repository: review.repository.name,
			score: review.analytics?.qualityScore ?? 0,
			issues: review.findings.length,
			summary: review.description ?? '',
			reviewId: review.id,
			reviewUrl: `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/reviews/${review.id}`,
		}

		await emailQueue.add(
			'send-review-complete',
			{ type: 'review:complete', payload },
			{ jobId: `review-complete-${review.id}`, attempts: 3 }
		)
	}
}
