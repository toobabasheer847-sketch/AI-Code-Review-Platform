import IORedis from 'ioredis'
import { env } from './env'

export interface RedisConnectionTarget {
  host: string
  port: number
}

export function getRedisConnectionTarget(redisUrl = env.REDIS_URL): RedisConnectionTarget {
  try {
    const url = new URL(redisUrl)
    const defaultPort = url.protocol === 'rediss:' ? 6380 : 6379
    return {
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port ? Number(url.port) : defaultPort,
    }
  } catch {
    throw new Error('REDIS_URL must be a valid Redis connection URL')
  }
}

export function redisReconnectDelayMs(attempt: number): number {
  const step = Math.max(0, Math.min(Math.floor(attempt), 5))
  return Math.min(100 * 2 ** step, 3_000)
}

export function createBullMqRedisConnection(): IORedis {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => redisReconnectDelayMs(attempt),
  })
}
