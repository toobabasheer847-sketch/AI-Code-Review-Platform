import express, { Express } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import pinoHttp from 'pino-http'
import rateLimit from 'express-rate-limit'
import { env } from '@/config/env'
import logger from '@/utils/logger'
import { errorMiddleware } from '@/middleware/error.middleware'
import authRoutes from '@/modules/auth/auth.routes'
import githubRoutes from '@/modules/github/github.routes'
import reviewRoutes from '@/modules/code-review/review.routes'
import billingRoutes from '@/modules/billing/billing.routes'
// Import routes when ready
// import userRoutes from '@/modules/users/user.routes'
// import repositoryRoutes from '@/modules/repositories/repository.routes'
// import reviewRoutes from '@/modules/code-review/review.routes'

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // Limit login attempts
  message: 'Too many login attempts, please try again later',
  skipSuccessfulRequests: true,
})

export const createApp = (): Express => {
  const app = express()

  // Trust proxy - important for rate limiting behind reverse proxy
  app.set('trust proxy', 1)

  // Security middleware
  app.use(helmet())
  app.use(cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }))

  // Logging middleware
  app.use(pinoHttp({ logger }))
  app.use(morgan('combined'))

  // Body parsing middleware
  // Capture raw body for Stripe webhooks when signature header present
  app.use((req, _res, next) => {
    if ((req.headers['stripe-signature'] as string) !== undefined) {
      let data = ''
      req.setEncoding('utf8')
      req.on('data', (chunk) => {
        data += chunk
      })
      req.on('end', () => {
        ;(req as any).rawBody = Buffer.from(data)
        next()
      })
    } else {
      next()
    }
  })

  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ limit: '10mb', extended: true }))

  // Rate limiting
  app.use('/api/', limiter)
  app.use('/api/auth/login', authLimiter)
  app.use('/api/auth/register', authLimiter)

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ 
      status: 'ok', 
      message: 'AI-CodeGuard API running',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    })
  })

  // API Routes
  app.use('/api/auth', authRoutes)
  app.use('/api/github', githubRoutes)
  app.use('/api/auth/github', githubRoutes)
  // app.use('/api/users', userRoutes)
  // app.use('/api/repositories', repositoryRoutes)
  app.use('/api/reviews', reviewRoutes)
  app.use('/api/billing', billingRoutes)

  // Error handling middleware (must be last)
  app.use(errorMiddleware)

  return app
}
