import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'

import { MailService } from '@/modules/email/mail.service'
import { env } from '@/config/env'
import logger from '@/utils/logger'
import type { AccountEmailJob } from '@/modules/email/account-email.types'
import type { ReviewCompletePayload } from '@/modules/email/email.types'

type EmailJobData =
  | { type: 'review:complete'; payload: ReviewCompletePayload }
  | AccountEmailJob

let connection: IORedis | null = null
let queueInstance: Queue<EmailJobData, void> | null = null
let emailWorker: Worker | null = null

function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })
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
          await mailer.sendEmailVerification(payload)
          break
        case 'auth:password-reset':
          await mailer.sendPasswordReset(payload)
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

  emailWorker.on('failed', (job) => {
    logger.error({ jobId: job?.id }, 'Email job failed')
  })

  emailWorker.on('error', () => {
    logger.error('Email worker error')
  })
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
