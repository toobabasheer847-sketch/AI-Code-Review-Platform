import type { Request, Response } from 'express'

import { isBetaAdmin, betaAdminEmails, type FeedbackCategory, feedbackCategories } from './beta.domain'
import { BetaService, BetaServiceError } from './beta.service'

function sendBetaError(error: unknown, res: Response): void {
  if (error instanceof BetaServiceError) {
    res.status(error.statusCode).json({ error: error.message })
    return
  }
  res.status(500).json({ error: 'Unable to complete this beta request.' })
}

export function requireBetaAdmin(req: Request, res: Response): boolean {
  if (!isBetaAdmin(req.user?.email, betaAdminEmails())) {
    res.status(403).json({ error: 'Beta administration is not available' })
    return false
  }
  return true
}

export class BetaController {
  constructor(private readonly service = new BetaService()) {}

  async guide(req: Request, res: Response): Promise<void> {
    try {
      res.json(await this.service.guide(req.user!.userId))
    } catch (error) {
      sendBetaError(error, res)
    }
  }

  async dismiss(req: Request, res: Response): Promise<void> {
    try {
      await this.service.dismissOnboarding(req.user!.userId)
      res.json({ dismissed: true })
    } catch (error) {
      sendBetaError(error, res)
    }
  }

  async list(req: Request, res: Response): Promise<void> {
    try {
      const category = typeof req.query.category === 'string' ? req.query.category : undefined
      if (category && !feedbackCategories.includes(category as FeedbackCategory)) {
        res.status(400).json({ error: 'Feedback category is invalid' })
        return
      }
      res.json({ feedback: await this.service.listOwn(req.user!.userId, category as FeedbackCategory | undefined) })
    } catch (error) {
      sendBetaError(error, res)
    }
  }

  async submit(req: Request, res: Response): Promise<void> {
    try {
      const feedback = await this.service.submit(req.user!.userId, req.body)
      res.status(201).json({ feedback })
    } catch (error) {
      sendBetaError(error, res)
    }
  }

  async overview(req: Request, res: Response): Promise<void> {
    if (!requireBetaAdmin(req, res)) return
    try {
      res.json(await this.service.overview())
    } catch (error) {
      sendBetaError(error, res)
    }
  }

  async updateStatus(req: Request, res: Response): Promise<void> {
    if (!requireBetaAdmin(req, res)) return
    try {
      const feedback = await this.service.updateStatus(req.params.id, req.body)
      res.json({ feedback })
    } catch (error) {
      sendBetaError(error, res)
    }
  }

  async setAccess(req: Request, res: Response): Promise<void> {
    if (!requireBetaAdmin(req, res)) return
    try {
      await this.service.setAccess(req.params.id, req.body)
      res.json({ updated: true })
    } catch (error) {
      sendBetaError(error, res)
    }
  }
}
