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

export function createBullMqRedisConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })
}
