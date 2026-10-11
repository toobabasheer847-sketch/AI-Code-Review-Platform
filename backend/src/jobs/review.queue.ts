import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { env } from '@/config/env'

const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
})

export interface ReviewJobData {
  reviewId: string
}

export const reviewQueue = new Queue<ReviewJobData>('code-review', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 500,
    removeOnFail: 1_000,
  },
})

export async function closeReviewQueue(): Promise<void> {
  await reviewQueue.close()
  await connection.quit()
}
