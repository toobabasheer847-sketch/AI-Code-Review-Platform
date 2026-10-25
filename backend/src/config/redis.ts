import { createClient } from 'redis'
import { env } from './env'
import logger from '@/utils/logger'
import { getRedisConnectionTarget } from './redis-connection'

export const redis = createClient({
  url: env.REDIS_URL,
})

redis.on('error', () => logger.error('Redis client error'))

export async function connectRedis(): Promise<void> {
  if (redis.isOpen) return
  await redis.connect()
  const serverInfo = await redis.sendCommand(['INFO', 'server'])
  const version = String(serverInfo).match(/^redis_version:([0-9.]+)/m)?.[1] ?? 'unknown'
  logger.info(
    {
      ...getRedisConnectionTarget(),
      version,
    },
    'Redis server connected'
  )
}

export async function disconnectRedis(): Promise<void> {
  if (!redis.isOpen) return
  await redis.quit()
  logger.info('Redis disconnected')
}
