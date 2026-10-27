import { Request, Response, Router } from 'express'
import { ChatService } from './chat.service'
import { ChatReviewNotFoundError } from './chat.service'
import { sendMessageSchema } from './chat.validation'
import { authMiddleware } from '@/middleware/auth.middleware'
import logger from '@/utils/logger'
import { RepositoryQAController } from './repository-qa.controller'

const chatService = new ChatService()

export class ChatController {
	async sendMessage(req: Request, res: Response): Promise<void> {
		const userId = req.user?.userId
		if (!userId) {
			res.status(401).json({ error: 'Unauthorized' })
			return
		}
		const parsed = sendMessageSchema.safeParse(req.body)
		if (!parsed.success) {
			res.status(400).json({ error: 'Invalid chat request.' })
			return
		}

		try {
			const result = await chatService.sendMessage(userId, parsed.data.reviewId, parsed.data.message)
			res.status(200).json(result)
		} catch (error) {
			if (error instanceof ChatReviewNotFoundError) {
				res.status(error.statusCode).json({ error: error.message })
				return
			}
			logger.error(
				{ errorType: error instanceof Error ? error.name : 'UnknownError' },
				'Chat request failed'
			)
			res.status(502).json({ error: 'Unable to generate a response right now.' })
		}
	}
}

export const chatRoutes = (): Router => {
	const router = Router()
	const controller = new ChatController()
	const repositoryQAController = new RepositoryQAController()

	router.post('/message', authMiddleware, (req, res) => controller.sendMessage(req, res))
	router.post('/repository-message', authMiddleware, (req, res) =>
		repositoryQAController.ask(req, res)
	)

	return router
}
