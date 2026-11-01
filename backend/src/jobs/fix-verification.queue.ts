import { Queue } from 'bullmq'
import { createBullMqRedisConnection } from '@/config/redis-connection'
import { env } from '@/config/env'
import type { VerificationJobDispatcher } from '@/modules/code-review/fix-verification.lifecycle'

export interface FixVerificationJobData {
  attemptId: string
}

let connection: ReturnType<typeof createBullMqRedisConnection> | null = null
let queueInstance: Queue<FixVerificationJobData> | null = null

function getConnection(): ReturnType<typeof createBullMqRedisConnection> {
  if (!connection) connection = createBullMqRedisConnection()
  return connection
}

function getFixVerificationQueue(): Queue<FixVerificationJobData> {
  if (!queueInstance) {
    queueInstance = new Queue<FixVerificationJobData>('fix-verification', {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: env.FIX_VERIFICATION_MAX_DISPATCH_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      },
    })
  }
  return queueInstance
}

export const fixVerificationQueue = new Proxy({} as Queue<FixVerificationJobData>, {
  get(_target, property) {
    const queue = getFixVerificationQueue()
    const value = Reflect.get(queue, property, queue)
    return typeof value === 'function' ? value.bind(queue) : value
  },
})

export async function enqueueFixVerificationJob(attemptId: string): Promise<void> {
  try {
    await fixVerificationQueue.add('verify-fix', { attemptId }, { jobId: attemptId })
  } catch (error) {
    if (!isDuplicateJobError(error)) throw error
  }
}

export function isDuplicateJobError(error: unknown): boolean {
  return error instanceof Error && /already exists|already waiting|JobId/i.test(error.message)
}

export const fixVerificationQueueDispatcher: VerificationJobDispatcher = {
  enqueue: enqueueFixVerificationJob,
}

export async function closeFixVerificationQueue(): Promise<void> {
  if (queueInstance) {
    await queueInstance.close()
    queueInstance = null
  }
  if (connection) {
    await connection.quit()
    connection = null
  }
}
