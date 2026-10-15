import { createApp } from './app'
import { env } from '@/config/env'
import { connectRedis } from '@/config/redis'
import { prisma } from '@/config/database'
import logger from '@/utils/logger'
import { closeReviewQueue } from '@/jobs/review.queue'
import { startReviewWorker, stopReviewWorker } from '@/jobs/review.worker'
import { closeEmailQueue, startEmailWorker } from '@/jobs/email.queue'
import { disconnectRedis } from '@/config/redis'
import { closeAutomationQueue } from '@/modules/automation/automation.queue'
import {
  startAutomationWorker,
  stopAutomationWorker,
} from '@/modules/automation/automation.worker'
import type { Server } from 'node:http'

const app = createApp()
let httpServer: Server | null = null
let isShuttingDown = false

async function bootstrap(): Promise<void> {
  try {
    await connectRedis()

    await prisma.$queryRaw`SELECT 1`
    logger.info('Database connected')
    await startEmailWorker()
    await startReviewWorker()
    await startAutomationWorker()

    httpServer = app.listen(env.PORT, () => {
      logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`)
    })
  } catch (error) {
    logger.error(
      { errorType: error instanceof Error ? error.name : 'UnknownError' },
      'Failed to start server'
    )
    process.exitCode = 1
  }
}

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return
  isShuttingDown = true
  logger.info({ signal }, 'Closing server')
  try {
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer?.close((error) => (error ? reject(error) : resolve()))
      })
    }
    await stopReviewWorker()
    await stopAutomationWorker()
    await closeReviewQueue()
    await closeAutomationQueue()
    await closeEmailQueue()
    await disconnectRedis()
    await prisma.$disconnect()
    process.exitCode = 0
  } catch (error) {
    logger.error(
      { errorType: error instanceof Error ? error.name : 'UnknownError' },
      'Graceful shutdown failed'
    )
    process.exitCode = 1
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

bootstrap()
