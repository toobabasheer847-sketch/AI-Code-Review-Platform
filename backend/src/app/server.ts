import { createApp } from './app'
import { env } from '@/config/env'
import { connectRedis } from '@/config/redis'
import { prisma } from '@/config/database'
import logger from '@/utils/logger'
import { closeReviewQueue } from '@/jobs/review.queue'
import { startReviewWorker, stopReviewWorker } from '@/jobs/review.worker'
import { closeEmailQueue } from '@/jobs/email.queue'

const app = createApp()

async function bootstrap(): Promise<void> {
  try {
    // Connect to Redis
    await connectRedis()

    // Verify database connection
    await prisma.$queryRaw`SELECT 1`
    logger.info('Database connected')
    await startReviewWorker()

    // Start server
    app.listen(env.PORT, () => {
      logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`)
    })
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server')
  await stopReviewWorker()
  await closeReviewQueue()
  await closeEmailQueue()
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing HTTP server')
  await stopReviewWorker()
  await closeReviewQueue()
  await closeEmailQueue()
  await prisma.$disconnect()
  process.exit(0)
})

bootstrap()
