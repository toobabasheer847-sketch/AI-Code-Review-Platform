import { Queue } from 'bullmq'
import { createBullMqRedisConnection } from '@/config/redis-connection'

export interface AutomationJobData {
  automationId: string
}

export function automationJobId(automationId: string, retryCount: number): string {
  return `automation-${automationId}-${retryCount}`
}

let connection: ReturnType<typeof createBullMqRedisConnection> | null = null
let queueInstance: Queue<AutomationJobData> | null = null

function getConnection(): ReturnType<typeof createBullMqRedisConnection> {
  if (!connection) {
    connection = createBullMqRedisConnection()
  }
  return connection
}

function getAutomationQueue(): Queue<AutomationJobData> {
  if (!queueInstance) {
    queueInstance = new Queue<AutomationJobData>('automation', {
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

export const automationQueue = new Proxy({} as Queue<AutomationJobData>, {
  get(_target, property) {
    const queue = getAutomationQueue()
    const value = Reflect.get(queue, property, queue)
    return typeof value === 'function' ? value.bind(queue) : value
  },
})

export async function closeAutomationQueue(): Promise<void> {
  if (queueInstance) {
    await queueInstance.close()
    queueInstance = null
  }
  if (connection) {
    await connection.quit()
    connection = null
  }
}
