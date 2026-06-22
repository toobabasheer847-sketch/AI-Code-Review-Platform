import { prisma } from '@/config/database'
import { emailQueue } from '@/jobs/email.queue'

export class ReviewService {
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
			createdAt: r.createdAt,
		}))
	}

	public async startReview(userId: string, repositoryUrl: string, branch = 'main') {
		// find or create repository for user
		const repository = await prisma.repository.upsert({
			where: { userId_url: { userId, url: repositoryUrl } },
			create: { userId, name: repositoryUrl, url: repositoryUrl },
			update: {},
		})

		const review = await prisma.codeReview.create({
			data: {
				userId,
				repositoryId: repository.id,
				title: `Code review: ${repository.name} (${branch})`,
				description: `Automated review for ${repository.name} on branch ${branch}`,
				fileContent: '',
				status: 'pending',
			},
		})

		// TODO: enqueue background job to perform analysis (review.queue)

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

		await emailQueue.add('send-review-complete', { type: 'review:complete', payload })
	}
}
