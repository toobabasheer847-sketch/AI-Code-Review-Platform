import { Queue, Worker } from 'bullmq'

import { getSafeMailErrorDetails, MailService } from '@/modules/email/mail.service'
import { createBullMqRedisConnection, getRedisConnectionTarget } from '@/config/redis-connection'
import logger from '@/utils/logger'
import type { AccountEmailJob } from '@/modules/email/account-email.types'
import { decryptVerificationOtp } from '@/modules/email/verification-otp.crypto'
import type { AutomationNotificationPayload, ReviewCompletePayload } from '@/modules/email/email.types'
import { prisma } from '@/config/database'

type EmailJobData =
  | { type: 'review:complete'; payload: ReviewCompletePayload }
  | { type: 'automation:notification'; payload: AutomationNotificationPayload }
  | AccountEmailJob

let connection: ReturnType<typeof createBullMqRedisConnection> | null = null
let queueInstance: Queue<EmailJobData, void> | null = null
let emailWorker: Worker | null = null

function getConnection(): ReturnType<typeof createBullMqRedisConnection> {
  if (!connection) {
    connection = createBullMqRedisConnection()
  }
  return connection
}

function getEmailQueue(): Queue<EmailJobData, void> {
  queueInstance ??= new Queue<EmailJobData, void>('email', {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 500,
      removeOnFail: 1_000,
    },
  })
  return queueInstance
}

export const emailQueue = new Proxy({} as Queue<EmailJobData, void>, {
  get(_target, property, receiver) {
    const queue = getEmailQueue()
    const value = Reflect.get(queue, property, receiver)
    return typeof value === 'function' ? value.bind(queue) : value
  },
})

export async function startEmailWorker(): Promise<void> {
  if (emailWorker) {
    return
  }

  const mailer = new MailService()
  emailWorker = new Worker<EmailJobData, void>(
    'email',
    async (job) => {
      const { type, payload } = job.data

      switch (type) {
        case 'review:complete':
          await mailer.sendReviewComplete(payload)
          break
        case 'auth:verify-email':
          await mailer.sendEmailVerification({
            to: payload.to,
            otp: decryptVerificationOtp(payload.otp),
          })
          break
        case 'auth:password-reset':
          await mailer.sendPasswordReset(payload)
          break
        case 'automation:notification':
          await mailer.sendAutomationNotification(payload)
          await prisma.automationNotification.updateMany({
            where: { id: payload.outboxId, status: 'QUEUED' },
            data: { status: 'SENT', sentAt: new Date(), lastError: null },
          })
          break

        default:
          throw new Error('Unsupported email job type')
      }
    },
    {
      connection: getConnection(),
    }
  )

  emailWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Email job completed')
  })

  emailWorker.on('failed', (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        jobType: job?.data.type,
        ...getSafeMailErrorDetails(error),
      },
      'Email job failed'
    )
    if (
      job?.data.type === 'automation:notification' &&
      job.attemptsMade >= (job.opts.attempts ?? 1)
    ) {
      void prisma.automationNotification.updateMany({
        where: {
          id: job.data.payload.outboxId,
          status: 'QUEUED',
          attemptCount: { lt: 2 },
        },
        data: {
          status: 'PENDING',
          queuedAt: null,
          attemptCount: { increment: 1 },
          lastError: 'EMAIL_DELIVERY_FAILED',
        },
      }).catch((error: unknown) => {
        logger.error(
          { errorType: error instanceof Error ? error.name : 'UnknownError' },
          'Failed to persist automation notification delivery failure'
        )
      })
      void prisma.automationNotification.updateMany({
        where: {
          id: job.data.payload.outboxId,
          status: 'QUEUED',
          attemptCount: { gte: 2 },
        },
        data: { status: 'FAILED', queuedAt: null, lastError: 'EMAIL_DELIVERY_FAILED' },
      }).catch((error: unknown) => {
        logger.error(
          { errorType: error instanceof Error ? error.name : 'UnknownError' },
          'Failed to persist terminal automation notification failure'
        )
      })
    }
  })

  emailWorker.on('error', (error) => {
    logger.error(
      {
        workerStarted: emailWorker?.isRunning() ?? false,
        ...getSafeMailErrorDetails(error),
      },
      'Email worker error'
    )
  })

  await emailWorker.waitUntilReady()
  const serverInfo = await getConnection().info('server')
  const version = serverInfo.match(/^redis_version:([0-9.]+)/m)?.[1]
  const target = getRedisConnectionTarget()
  logger.info({ ...target, version: version ?? 'unknown' }, 'BullMQ Redis server detected')
  if (!version || !isRedisVersionSupported(version)) {
    await emailWorker.close()
    emailWorker = null
    throw new Error(
      `BullMQ email processing requires Redis 6.2 or newer; connected to ${target.host}:${target.port} (detected ${version ?? 'unknown'}).`
    )
  }
  logger.info({ workerStarted: emailWorker.isRunning() }, 'Email worker ready')
}

export function isRedisVersionSupported(version: string): boolean {
  const parts = version.split('.').map(Number)
  if (parts.length < 2 || parts.some((part) => !Number.isInteger(part))) return false
  return parts[0] > 6 || (parts[0] === 6 && parts[1] >= 2)
}

export async function closeEmailQueue(): Promise<void> {
  if (emailWorker) {
    await emailWorker.close()
    emailWorker = null
  }
  if (queueInstance) {
    await queueInstance.close()
    queueInstance = null
  }
  if (connection) {
    await connection.quit()
    connection = null
  }
}
