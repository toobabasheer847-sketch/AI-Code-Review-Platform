import { prisma } from '@/config/database'
import { emailQueue } from '@/jobs/email.queue'
import { reviewQueue } from '@/jobs/review.queue'
import { GitHubService } from '@/modules/github/github.service'
import { releaseReviewQuota, reserveReviewQuota } from '@/modules/billing/review-quota'
import { summarizeFindingLifecycle } from './finding-lifecycle.domain'

export class ReviewNotFoundError extends Error {
	public readonly statusCode = 404

	constructor() {
		super('Review not found')
		this.name = 'ReviewNotFoundError'
	}
}

const reviewRelations = {
	repository: true,
	findings: {
		include: {
			feedback: {
				include: { user: { select: { fullName: true } } },
				orderBy: { createdAt: 'asc' as const },
			},
			fixProposals: {
				include: { attempts: { orderBy: { createdAt: 'desc' as const } } },
				orderBy: { createdAt: 'desc' as const },
			},
		},
	},
	analytics: true,
	chatConversation: {
		include: { messages: { orderBy: { createdAt: 'asc' as const } } },
	},
	webhookDeliveries: {
		select: { status: true },
		orderBy: { createdAt: 'desc' as const },
		take: 1,
	},
}

async function findOwnedReview(userId: string, reviewId: string) {
	return prisma.codeReview.findFirst({
		where: { id: reviewId, userId },
		include: reviewRelations,
	})
}

async function deleteOwnedReview(userId: string, reviewId: string): Promise<number> {
	const result = await prisma.codeReview.deleteMany({
		where: { id: reviewId, userId },
	})
	return result.count
}

export type OwnedReview = NonNullable<Awaited<ReturnType<typeof findOwnedReview>>>

export interface ReviewAccessStore {
	findOwnedReview(userId: string, reviewId: string): Promise<OwnedReview | null>
	deleteOwnedReview(userId: string, reviewId: string): Promise<number>
}

interface ReviewServiceDependencies {
	githubService?: Pick<GitHubService, 'validateReviewTarget'>
	reviewAccess?: ReviewAccessStore
}

export class ReviewService {
	private readonly githubService: Pick<GitHubService, 'validateReviewTarget'>
	private readonly reviewAccess: ReviewAccessStore

	constructor(
		dependencies: ReviewServiceDependencies = {}
	) {
		this.githubService = dependencies.githubService ?? new GitHubService()
		this.reviewAccess = dependencies.reviewAccess ?? {
			findOwnedReview,
			deleteOwnedReview,
		}
	}

	public async listReviews(userId: string) {
		const reviews = await prisma.codeReview.findMany({
			where: { userId },
			include: {
				repository: true,
				findings: true,
				analytics: true,
				webhookDeliveries: {
					select: { status: true },
					orderBy: { createdAt: 'desc' },
					take: 1,
				},
			},
			orderBy: { createdAt: 'desc' },
		})

		return reviews.map((r) => ({
			id: r.id,
			repository: r.repository.name,
			score: r.analytics?.qualityScore ?? null,
			issues: r.findings.length,
			status: r.status,
			source: r.source,
			pullRequestNumber: r.pullRequestNumber,
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
		} catch {
			try {
				await prisma.$transaction(async (transaction) => {
					await transaction.codeReview.update({
						where: { id: review.id },
						data: {
							status: 'failed',
							errorMessage: 'Unable to queue review. Queue details were omitted.',
						},
					})
					await releaseReviewQuota(transaction, userId, review.createdAt)
				})
			} catch {
				throw new Error('Unable to queue review and release its reserved quota')
			}
			throw new Error('Unable to queue review')
		}

		return review
	}

	public async getReview(userId: string, reviewId: string) {
		const review = await this.reviewAccess.findOwnedReview(userId, reviewId)

		if (!review) throw new ReviewNotFoundError()

		return {
			id: review.id,
			repository: review.repository,
			title: review.title,
			description: review.description,
			fileContent: review.fileContent,
			findings: review.findings,
			findingLifecycleAnalytics: summarizeFindingLifecycle(review.findings),
			analytics: review.analytics,
			chat: review.chatConversation,
			status: review.status,
			branch: review.branch,
			errorMessage: review.errorMessage,
			source: review.source,
			reviewLimitations: review.reviewLimitations,
			pullRequestNumber: review.pullRequestNumber,
			pullRequestUrl: review.pullRequestUrl,
			pullRequestStatus: review.webhookDeliveries[0]?.status ?? null,
			createdAt: review.createdAt,
		}
	}

	public async deleteReview(userId: string, reviewId: string) {
		const deleted = await this.reviewAccess.deleteOwnedReview(userId, reviewId)
		if (deleted === 0) throw new ReviewNotFoundError()
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
