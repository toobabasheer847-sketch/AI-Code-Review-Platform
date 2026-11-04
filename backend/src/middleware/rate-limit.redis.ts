import type { IncrementResponse, Store } from 'express-rate-limit';
import { redis } from '@/config/redis';
import logger from '@/utils/logger';

export const RATE_LIMIT_INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

export const RATE_LIMIT_DECREMENT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
local current = redis.call('DECR', KEYS[1])
if current <= 0 then
  redis.call('DEL', KEYS[1])
  return 0
end
return current
`;

export class RateLimitUnavailableError extends Error {
  constructor(readonly policy: string) {
    super('Shared rate limit store is unavailable');
    this.name = 'RateLimitUnavailableError';
  }
}

export interface RateLimitRedis {
  evalScript(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export const applicationRateLimitRedis: RateLimitRedis = {
  async evalScript(script, keys, args) {
    return redis.eval(script, { keys, arguments: args });
  },
};

let redisOverride: RateLimitRedis | null = null;

export function useRateLimitRedis(client: RateLimitRedis | null): void {
  if (process.env.NODE_ENV === 'production' && client) {
    throw new Error('Rate limit storage cannot be replaced in production');
  }
  redisOverride = client;
}

export function getRateLimitRedis(): RateLimitRedis {
  return redisOverride ?? applicationRateLimitRedis;
}

export function createMemoryRateLimitRedis(now: () => number = Date.now): RateLimitRedis {
  const values = new Map<string, { hits: number; expiresAt: number }>();
  const read = (key: string) => {
    const entry = values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      values.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    async evalScript(script, keys, args) {
      const key = keys[0];
      if (!key) throw new Error('Rate limit key is missing');
      if (script === RATE_LIMIT_INCREMENT_SCRIPT) {
        const windowMs = Number(args[0]);
        const existing = read(key);
        if (!existing) {
          values.set(key, { hits: 1, expiresAt: now() + windowMs });
          return [1, windowMs];
        }
        existing.hits += 1;
        return [existing.hits, Math.max(0, existing.expiresAt - now())];
      }
      if (script === RATE_LIMIT_DECREMENT_SCRIPT) {
        const existing = read(key);
        if (!existing) return 0;
        existing.hits -= 1;
        if (existing.hits <= 0) {
          values.delete(key);
          return 0;
        }
        return existing.hits;
      }
      throw new Error('Unsupported rate limit script');
    },
  };
}

export function createUnavailableRateLimitRedis(): RateLimitRedis {
  return {
    async evalScript() {
      const error = new Error('Redis connection refused');
      error.name = 'RedisConnectionError';
      throw error;
    },
  };
}

function parseCount(value: unknown, policy: string): number {
  const count = Number(value);
  if (!Number.isInteger(count)) throw new RateLimitUnavailableError(policy);
  return count;
}

export class RedisRateLimitStore implements Store {
  windowMs = 60_000;
  localKeys = false;
  prefix: string;
  private lastOutageLogAt = 0;

  constructor(
    private readonly policy: string,
    private readonly failureMode: 'fail-open' | 'fail-closed',
    private readonly resolveClient: () => RateLimitRedis = getRateLimitRedis
  ) {
    this.prefix = `${policy}:`;
  }

  init(options: { windowMs?: number }): void {
    if (options.windowMs && options.windowMs > 0) this.windowMs = options.windowMs;
  }

  prefixKey(key: string): string {
    return `rl:${this.policy}:${key}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      const raw = await this.resolveClient().evalScript(
        RATE_LIMIT_INCREMENT_SCRIPT,
        [this.prefixKey(key)],
        [String(this.windowMs)]
      );
      if (!Array.isArray(raw) || raw.length < 2) throw new RateLimitUnavailableError(this.policy);
      const totalHits = parseCount(raw[0], this.policy);
      const ttl = parseCount(raw[1], this.policy);
      return {
        totalHits,
        resetTime: new Date(Date.now() + Math.max(0, ttl)),
      };
    } catch (error) {
      if (error instanceof RateLimitUnavailableError && this.failureMode === 'fail-closed')
        throw error;
      this.noteOutage(error);
      if (this.failureMode === 'fail-open') {
        return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
      }
      throw new RateLimitUnavailableError(this.policy);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.resolveClient().evalScript(RATE_LIMIT_DECREMENT_SCRIPT, [this.prefixKey(key)], []);
    } catch (error) {
      this.noteOutage(error);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.decrement(key);
  }

  private noteOutage(error: unknown): void {
    const now = Date.now();
    if (now - this.lastOutageLogAt < 5_000) return;
    this.lastOutageLogAt = now;
    logger.error(
      {
        policy: this.policy,
        failureMode: this.failureMode,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      },
      'Shared rate limit store is unavailable'
    );
  }
}
