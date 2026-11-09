import { createClient, type RedisClientType } from 'redis'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export class DisposableRedisError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DisposableRedisError'
  }
}

export interface DisposableRedisTarget {
  redisUrl: string
  hostname: string
  port: number
  database: number
}

function databaseIndex(target: URL): number {
  const raw = decodeURIComponent(target.pathname.replace(/^\//, ''))
  if (!raw) return 0
  if (!/^\d+$/.test(raw)) {
    throw new DisposableRedisError('Disposable Redis database index must be an integer from 1 to 15')
  }
  return Number(raw)
}

export function canonicalRedisUrl(redisUrl: string): string {
  const url = new URL(redisUrl)
  url.hash = ''
  url.username = ''
  url.password = ''
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

export function assertDisposableRedis(redisUrl: string): DisposableRedisTarget {
  let target: URL
  try {
    target = new URL(redisUrl)
  } catch {
    throw new DisposableRedisError('REDIS_INTEGRATION_URL must be a valid Redis URL')
  }
  if (target.protocol !== 'redis:' && target.protocol !== 'rediss:') {
    throw new DisposableRedisError('REDIS_INTEGRATION_URL must use the redis protocol')
  }
  const hostname = target.hostname.replace(/^\[|\]$/g, '')
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new DisposableRedisError(
      'REDIS_INTEGRATION_URL must point at localhost. Refusing remote Redis hosts.'
    )
  }
  const port = target.port ? Number(target.port) : target.protocol === 'rediss:' ? 6380 : 6379
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DisposableRedisError('REDIS_INTEGRATION_URL has an invalid port')
  }
  const database = databaseIndex(target)
  if (!Number.isInteger(database) || database < 0 || database > 15) {
    throw new DisposableRedisError('Disposable Redis database index must be an integer from 0 to 15')
  }
  const dedicatedPort = port === 6390
  const isolatedDatabase = database >= 1
  if (!dedicatedPort && !isolatedDatabase) {
    throw new DisposableRedisError(
      'Disposable Redis must use port 6390 or database index 1-15 so it cannot flush the application instance.'
    )
  }
  const applicationUrl = process.env.REDIS_URL?.trim()
  if (applicationUrl && canonicalRedisUrl(applicationUrl) === canonicalRedisUrl(redisUrl)) {
    throw new DisposableRedisError(
      'REDIS_INTEGRATION_URL must not be the application REDIS_URL.'
    )
  }
  return { redisUrl, hostname, port, database }
}

export function resolveDisposableRedisUrl(): string | undefined {
  const configured = process.env.REDIS_INTEGRATION_URL?.trim()
  if (!configured) return undefined
  return assertDisposableRedis(configured).redisUrl
}

export interface DisposableRedisClient {
  evalScript(script: string, keys: string[], args: string[]): Promise<unknown>
  connect(): Promise<void>
  disconnect(): Promise<void>
  readKey(key: string): Promise<string | null>
  deleteByPrefix(prefix: string): Promise<void>
}

export function createDisposableRedisClient(redisUrl: string): DisposableRedisClient {
  assertDisposableRedis(redisUrl)
  const client: RedisClientType = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy: () => new Error('Disposable Redis reconnect is disabled'),
    },
  })
  client.on('error', () => undefined)
  return {
    async connect() {
      if (!client.isOpen) await client.connect()
    },
    async disconnect() {
      if (client.isOpen) await client.disconnect()
    },
    async evalScript(script, keys, args) {
      return client.eval(script, { keys, arguments: args })
    },
    async readKey(key) {
      return client.get(key)
    },
    async deleteByPrefix(prefix) {
      const matched: string[] = []
      for await (const key of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
        if (Array.isArray(key)) matched.push(...key)
        else matched.push(key)
      }
      if (matched.length > 0) await client.del(matched)
    },
  }
}
