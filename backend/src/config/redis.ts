import { createClient } from 'redis'
import { env } from './env'
import logger from '@/utils/logger'
import { getRedisConnectionTarget, redisReconnectDelayMs } from './redis-connection'
import { reportBackendError } from '@/utils/error-monitoring'

const redisTarget = getRedisConnectionTarget()

export const redis = createClient({
  url: env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => redisReconnectDelayMs(retries),
  },
})

redis.on('error', (error) => {
  reportBackendError(error, 'redis')
  const errorCode =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : undefined
  logger.error(
    {
      ...redisTarget,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      ...(errorCode ? { errorCode } : {}),
    },
    'Redis client error'
  )
})

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
