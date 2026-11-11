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
import {
  startAutomationScheduler,
  stopAutomationScheduler,
} from '@/modules/automation/automation.scheduler'
import { closeSocialQueue } from '@/modules/social/social.queue'
import { MailConfigurationError } from '@/modules/email/mail.service'
import { startSocialWorker, stopSocialWorker } from '@/modules/social/social.worker'
import { closeFixVerificationQueue } from '@/jobs/fix-verification.queue'
import {
  startFixVerificationWorker,
  stopFixVerificationWorker,
} from '@/jobs/fix-verification.worker'
import type { Server } from 'node:http'
import { runShutdownStep } from './shutdown'
import {
  flushErrorMonitoring,
  initializeErrorMonitoring,
  reportBackendError,
} from '@/utils/error-monitoring'

const app = createApp()
let httpServer: Server | null = null
let isShuttingDown = false
initializeErrorMonitoring()

async function closeResource(resource: string, cleanup: () => Promise<unknown>): Promise<boolean> {
  try {
    await runShutdownStep(cleanup)
    return true
  } catch (error) {
    logger.error(
      { resource, errorType: error instanceof Error ? error.name : 'UnknownError' },
      'Shutdown cleanup failed'
    )
    if (resource !== 'errorMonitoring') reportBackendError(error, 'startup')
    return false
  }
}

async function bootstrap(): Promise<void> {
  try {
    await connectRedis()

    await prisma.$queryRaw`SELECT 1`
    logger.info('Database connected')
    await startEmailWorker()
    await startReviewWorker()
    await startAutomationWorker()
    startAutomationScheduler()
    await startSocialWorker()
    await startFixVerificationWorker()

    httpServer = app.listen(env.PORT, () => {
      logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`)
    })
  } catch (error) {
    reportBackendError(error, 'startup')
    logger.error(
      {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        ...(error instanceof MailConfigurationError ? { diagnostic: error.message } : {}),
        ...(error instanceof Error && error.message.startsWith('BullMQ email processing requires Redis')
          ? { diagnostic: error.message }
          : {}),
      },
      'Failed to start server'
    )
    await shutdown('startup-failure', 1)
  }
}

async function shutdown(signal: string, initialExitCode = 0): Promise<void> {
  if (isShuttingDown) return
  isShuttingDown = true
  logger.info({ signal }, 'Closing server')
  const cleanups: Array<[string, () => Promise<unknown>]> = [
    [
      'httpServer',
      () =>
        new Promise<void>((resolve, reject) => {
          if (!httpServer) {
            resolve()
            return
          }
          httpServer.close((error) => (error ? reject(error) : resolve()))
        }),
    ],
    ['automationScheduler', stopAutomationScheduler],
    ['reviewWorker', stopReviewWorker],
    ['automationWorker', stopAutomationWorker],
    ['socialWorker', stopSocialWorker],
    ['fixVerificationWorker', stopFixVerificationWorker],
    ['fixVerificationQueue', closeFixVerificationQueue],
    ['reviewQueue', closeReviewQueue],
    ['automationQueue', closeAutomationQueue],
    ['socialQueue', closeSocialQueue],
    ['emailQueue', closeEmailQueue],
    ['redis', disconnectRedis],
    ['database', () => prisma.$disconnect()],
  ]
  let exitCode = initialExitCode
  for (const [resource, cleanup] of cleanups) {
    if (!(await closeResource(resource, cleanup))) exitCode = 1
  }
  if (!(await closeResource('errorMonitoring', () => flushErrorMonitoring()))) exitCode = 1
  process.exitCode = exitCode
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

bootstrap()
