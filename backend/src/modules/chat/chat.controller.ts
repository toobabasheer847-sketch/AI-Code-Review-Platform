import { Request, Response, Router } from 'express'
import { ChatService } from './chat.service'
import { sendMessageSchema } from './chat.validation'
import { authMiddleware } from '@/middleware/auth.middleware'

const chatService = new ChatService()

export class ChatController {
	async sendMessage(req: Request, res: Response): Promise<void> {
		try {
			const input = sendMessageSchema.parse(req.body)
			if (!req.user?.userId) {
				res.status(401).json({ error: 'Unauthorized' })
				return
			}

			const result = await chatService.sendMessage(req.user.userId, input.reviewId, input.message)
			res.status(200).json(result)
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to send message'
			res.status(400).json({ error: message })
		}
	}
}

export const chatRoutes = (): Router => {
	const router = Router()
	const controller = new ChatController()

	router.post('/message', authMiddleware, (req, res) => controller.sendMessage(req, res))

	return router
}
