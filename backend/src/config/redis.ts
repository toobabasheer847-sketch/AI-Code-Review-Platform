import { createClient } from 'redis'
import { env } from './env'

export const redis = createClient({
  url: env.REDIS_URL,
})

redis.on('error', (err: Error) => console.error('Redis Client Error', err))

export async function connectRedis(): Promise<void> {
  try {
    await redis.connect()
    console.log('Redis connected')
  } catch (error) {
    console.error('Redis connection failed:', error)
  }
}

export async function disconnectRedis(): Promise<void> {
  try {
    await redis.disconnect()
    console.log('Redis disconnected')
  } catch (error) {
    console.error('Redis disconnection failed:', error)
  }
}
