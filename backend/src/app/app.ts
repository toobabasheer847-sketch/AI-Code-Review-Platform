import express, { Express } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import pinoHttp from 'pino-http'
import rateLimit from 'express-rate-limit'
import { env } from '@/config/env'
import logger from '@/utils/logger'
import { errorMiddleware } from '@/middleware/error.middleware'
import { createApiRoutes } from '@/routes'

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
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
  app.use(cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }))

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
  app.use(
    morgan('combined', {
      skip: (req) =>
        req.path.endsWith('/github/callback') ||
        req.path === '/api/auth/verify-email' ||
        req.path === '/api/auth/password-reset/confirm',
    })
  )

  app.use('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }))
  app.use('/api/webhooks/github', express.raw({ type: 'application/json', limit: '1mb' }))
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ limit: '10mb', extended: true }))

  app.use('/api/', limiter)
  app.use('/api/auth/login', authLimiter)
  app.use('/api/auth/register', authLimiter)

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      message: 'AI-CodeGuard API running',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    })
  })

  app.use('/api', createApiRoutes())

  app.use(errorMiddleware)

  return app
}
