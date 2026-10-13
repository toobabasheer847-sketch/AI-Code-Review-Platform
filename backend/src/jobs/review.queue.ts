import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { env } from '@/config/env'

export interface ReviewJobData {
  reviewId: string
}

let connection: IORedis | null = null
let queueInstance: Queue<ReviewJobData> | null = null

function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    })
  }
  return connection
}

function getReviewQueue(): Queue<ReviewJobData> {
  if (!queueInstance) {
    queueInstance = new Queue<ReviewJobData>('code-review', {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      },
    })
  }
  return queueInstance
}

export const reviewQueue = new Proxy({} as Queue<ReviewJobData>, {
  get(_target, property) {
    const queue = getReviewQueue()
    const value = Reflect.get(queue, property, queue)
    return typeof value === 'function' ? value.bind(queue) : value
  },
})

export async function closeReviewQueue(): Promise<void> {
  if (queueInstance) {
    await queueInstance.close()
    queueInstance = null
  }
  if (connection) {
    await connection.quit()
    connection = null
  }
}
