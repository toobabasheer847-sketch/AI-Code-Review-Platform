import { createClient } from 'redis'
import { env } from './env'
import logger from '@/utils/logger'

export const redis = createClient({
  url: env.REDIS_URL,
})

redis.on('error', () => logger.error('Redis client error'))

export async function connectRedis(): Promise<void> {
  if (redis.isOpen) return
  await redis.connect()
  logger.info('Redis connected')
}

export async function disconnectRedis(): Promise<void> {
  if (!redis.isOpen) return
  await redis.quit()
  logger.info('Redis disconnected')
}
