import { Router } from 'express'
import { PullRequestWebhookController } from './pull-request-webhook.controller'

const router = Router()
const controller = new PullRequestWebhookController()

router.post('/', (req, res) => controller.receive(req, res))

export default router
