import express, { Express } from 'express'
import helmet from 'helmet'
import pinoHttp from 'pino-http'
import rateLimit from 'express-rate-limit'
import { env } from '@/config/env'
import logger from '@/utils/logger'
import { errorMiddleware } from '@/middleware/error.middleware'
import { apiSecurityMiddleware } from '@/middleware/api-security.middleware'
import { corsMiddleware } from '@/middleware/cors.middleware'
import { createApiRoutes } from '@/routes'
import { prisma } from '@/config/database'
import { redis } from '@/config/redis'
import { reviewQueue } from '@/jobs/review.queue'
import { emailQueue } from '@/jobs/email.queue'
import { automationQueue } from '@/modules/automation/automation.queue'
import { getAutomationSchedulerHealth } from '@/modules/automation/automation.scheduler'
import { socialQueue } from '@/modules/social/social.queue'
import { fixVerificationQueue } from '@/jobs/fix-verification.queue'

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (request) =>
    request.originalUrl.split('?')[0] === '/api/reviews/internal/verification-callback',
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later',
  skipSuccessfulRequests: true,
})

export const createApp = (): Express => {
  const app = express()

  app.set('trust proxy', 1)

  app.use(helmet())
  app.use(corsMiddleware)

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url?.split('?')[0],
            remoteAddress: request.remoteAddress,
          }
        },
      },
    })
  )
  app.use('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }))
  app.use('/api/webhooks/github', express.raw({ type: 'application/json', limit: '1mb' }))
  app.use(
    '/api/reviews/internal/verification-callback',
    express.raw({ type: 'application/json', limit: '128kb' })
  )
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ limit: '10mb', extended: true }))

  app.use('/api/', limiter)
  app.use('/api/auth/login', authLimiter)
  app.use('/api/auth/register', authLimiter)
  app.use('/api', apiSecurityMiddleware)

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      await redis.ping()
      const [reviewJobs, emailJobs, automationJobs, socialJobs, verificationJobs] =
        await Promise.all([
          reviewQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          emailQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          automationQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          socialQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          fixVerificationQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
        ])
      const scheduler = getAutomationSchedulerHealth()
      const schedulerStatus = !scheduler.running
        ? 'starting'
        : scheduler.lastSuccessfulTickAt &&
            scheduler.lastFailureType === null
          ? 'ok'
          : scheduler.lastFailureType
            ? 'degraded'
            : 'starting'
      res.json({
        status: schedulerStatus === 'degraded' ? 'degraded' : 'ok',
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
        dependencies: {
          database: 'ok',
          redis: 'ok',
          queues: 'ok',
          scheduler: schedulerStatus,
        },
        queues: {
          reviews: reviewJobs,
          email: emailJobs,
          automations: automationJobs,
          socialPublications: socialJobs,
          fixVerification: verificationJobs,
        },
        scheduler,
      })
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Readiness health check failed'
      )
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        dependencies: { database: 'unknown', redis: 'unknown', queues: 'unknown' },
      })
    }
  })

  app.use('/api', createApiRoutes())

  app.use(errorMiddleware)

  return app
}
