import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'

import { MailService } from '@/modules/email/mail.service'
import { env } from '@/config/env'

let connection: any = null
let queueInstance: any = null
let emailWorker: Worker | null = null

function getConnection(): IORedis {
  if (!connection) {
    connection = new (IORedis as unknown as {
      new (url: string, options?: { maxRetriesPerRequest: number | null }): any;
    })(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    })
  }
  return connection as IORedis
}

function getEmailQueue(): Queue {
  queueInstance ??= new Queue('email', {
    connection: getConnection(),
  })
  return queueInstance as Queue
}

export const emailQueue = new Proxy({} as Queue, {
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
  emailWorker = new Worker(
    'email',
    async (job) => {
      const { type, payload } = job.data

      switch (type) {
        case 'review:complete':
          await mailer.sendReviewComplete(payload)
          break

        default:
          console.warn(`Unknown job type: ${type}`)
      }
    },
    {
      connection: getConnection(),
    }
  )

  emailWorker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`)
  })

  emailWorker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed`, err)
  })

  emailWorker.on('error', (err) => {
    console.error('Worker Error:', err)
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
