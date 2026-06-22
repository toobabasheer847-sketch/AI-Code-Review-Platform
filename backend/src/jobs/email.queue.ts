import { Queue, Worker } from 'bullmq'
import { MailService } from '@/modules/email/mail.service'
import { env } from '@/config/env'

const redisConnection = { url: env.REDIS_URL }
export const emailQueue = new Queue('email', { connection: redisConnection })

const mailer = new MailService()

new Worker(
  'email',
  async (job) => {
    const { type, payload } = job.data
    if (type === 'review:complete') {
      await mailer.sendReviewComplete(payload)
    }
  },
  { connection: redisConnection }
)
