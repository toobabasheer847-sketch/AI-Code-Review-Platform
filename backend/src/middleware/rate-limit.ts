import type { Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  RateLimitUnavailableError,
  RedisRateLimitStore,
  type RateLimitRedis,
  getRateLimitRedis,
} from './rate-limit.redis';

export type RateLimitFailureMode = 'fail-open' | 'fail-closed';
export type RateLimitIdentity = 'ip' | 'user';

export interface RateLimitPolicy {
  name: string;
  windowMs: number;
  limit: number;
  error: string;
  identity: RateLimitIdentity;
  failureMode: RateLimitFailureMode;
  skipSuccessfulRequests?: boolean;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_MINUTE = 60_000;

export function readRateLimitBound(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}. Values outside that range are rejected so a deployment cannot weaken the built-in limit.`
    );
  }
  return value;
}

function windowSetting(name: string, fallback: number): number {
  return readRateLimitBound(name, fallback, fallback, 24 * 60 * 60 * 1000);
}

function maxSetting(name: string, fallback: number): number {
  return readRateLimitBound(name, fallback, 1, fallback);
}

export const rateLimitPolicies = {
  api: {
    name: 'api',
    windowMs: windowSetting('RATE_LIMIT_API_WINDOW_MS', FIFTEEN_MINUTES),
    limit: maxSetting('RATE_LIMIT_API_MAX', 100),
    error: 'Too many requests from this IP, please try again later',
    identity: 'ip',
    failureMode: 'fail-open',
  },
  loginRegistration: {
    name: 'login-registration',
    windowMs: windowSetting('RATE_LIMIT_LOGIN_WINDOW_MS', FIFTEEN_MINUTES),
    limit: maxSetting('RATE_LIMIT_LOGIN_MAX', 5),
    error: 'Too many login attempts, please try again later',
    identity: 'ip',
    failureMode: 'fail-closed',
    skipSuccessfulRequests: true,
  },
  accountSecurity: {
    name: 'account-security',
    windowMs: windowSetting('RATE_LIMIT_ACCOUNT_WINDOW_MS', FIFTEEN_MINUTES),
    limit: maxSetting('RATE_LIMIT_ACCOUNT_MAX', 5),
    error: 'Too many account security requests. Please try again later.',
    identity: 'ip',
    failureMode: 'fail-closed',
  },
  emailVerification: {
    name: 'email-verification',
    windowMs: windowSetting('RATE_LIMIT_VERIFICATION_WINDOW_MS', FIFTEEN_MINUTES),
    limit: maxSetting('RATE_LIMIT_VERIFICATION_MAX', 10),
    error: 'Too many verification attempts. Please try again later.',
    identity: 'ip',
    failureMode: 'fail-closed',
  },
  manualReview: {
    name: 'manual-review',
    windowMs: windowSetting('RATE_LIMIT_REVIEW_WINDOW_MS', FIFTEEN_MINUTES),
    limit: maxSetting('RATE_LIMIT_REVIEW_MAX', 10),
    error: 'Too many code review requests. Try again later.',
    identity: 'user',
    failureMode: 'fail-closed',
  },
  repositoryQa: {
    name: 'repository-qa',
    windowMs: windowSetting('RATE_LIMIT_REPOSITORY_QA_WINDOW_MS', FIFTEEN_MINUTES),
    limit: maxSetting('RATE_LIMIT_REPOSITORY_QA_MAX', 20),
    error: 'Too many repository questions. Try again later.',
    identity: 'user',
    failureMode: 'fail-closed',
  },
  automation: {
    name: 'automation',
    windowMs: windowSetting('RATE_LIMIT_AUTOMATION_WINDOW_MS', ONE_MINUTE),
    limit: maxSetting('RATE_LIMIT_AUTOMATION_MAX', 10),
    error: 'Too many automation planning requests. Try again shortly.',
    identity: 'ip',
    failureMode: 'fail-closed',
  },
  automationUser: {
    name: 'automation-user',
    windowMs: windowSetting('RATE_LIMIT_AUTOMATION_WINDOW_MS', ONE_MINUTE),
    limit: maxSetting('RATE_LIMIT_AUTOMATION_MAX', 10),
    error: 'Too many automation planning requests. Try again shortly.',
    identity: 'user',
    failureMode: 'fail-closed',
  },
  aiGeneration: {
    name: 'ai-generation',
    windowMs: windowSetting('RATE_LIMIT_AI_WINDOW_MS', FIFTEEN_MINUTES),
    limit: maxSetting('RATE_LIMIT_AI_MAX', 20),
    error: 'Too many AI generation requests. Try again later.',
    identity: 'user',
    failureMode: 'fail-closed',
  },
  github: {
    name: 'github',
    windowMs: windowSetting('RATE_LIMIT_GITHUB_WINDOW_MS', ONE_MINUTE),
    limit: maxSetting('RATE_LIMIT_GITHUB_MAX', 30),
    error: 'Too many GitHub requests, please try again later',
    identity: 'ip',
    failureMode: 'fail-open',
  },
  integration: {
    name: 'integration',
    windowMs: windowSetting('RATE_LIMIT_INTEGRATION_WINDOW_MS', ONE_MINUTE),
    limit: maxSetting('RATE_LIMIT_INTEGRATION_MAX', 20),
    error: 'Too many integration requests. Try again shortly.',
    identity: 'ip',
    failureMode: 'fail-open',
  },
  social: {
    name: 'social',
    windowMs: windowSetting('RATE_LIMIT_SOCIAL_WINDOW_MS', ONE_MINUTE),
    limit: maxSetting('RATE_LIMIT_SOCIAL_MAX', 20),
    error: 'Too many social publishing requests. Try again shortly.',
    identity: 'ip',
    failureMode: 'fail-open',
  },
  workspaceInvitationEmail: {
    name: 'workspace-invitation-email',
    windowMs: windowSetting('RATE_LIMIT_INVITATION_WINDOW_MS', FIFTEEN_MINUTES),
    limit: maxSetting('RATE_LIMIT_INVITATION_MAX', 10),
    error: 'Too many invitation emails. Try again later.',
    identity: 'user',
    failureMode: 'fail-closed',
  },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof rateLimitPolicies;

export function resolveTrustProxySetting(raw = process.env.TRUST_PROXY_HOPS): false | number {
  if (raw === undefined || raw.trim() === '' || raw === 'false' || raw === '0') return false;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'all') {
    throw new Error(
      'TRUST_PROXY_HOPS must be the exact number of trusted reverse proxies. Trusting every forwarded address lets a client spoof X-Forwarded-For and bypass rate limits.'
    );
  }
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 1 || hops > 5) {
    throw new Error(
      'TRUST_PROXY_HOPS must be an integer from 1 to 5, or be unset to ignore X-Forwarded-For.'
    );
  }
  return hops;
}

function ipv6Network(ip: string): string {
  const halves = ip.split('::');
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 ? halves[1].split(':').filter(Boolean) : [];
  const missing = Math.max(0, 8 - head.length - tail.length);
  const groups = [...head, ...Array.from({ length: missing }, () => '0'), ...tail].slice(0, 4);
  return `${groups.map((group) => group.padStart(4, '0')).join(':')}::/64`;
}

function clientIp(req: Request): string {
  const raw = (req.ip ?? '').trim().toLowerCase();
  if (!raw) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped?.[1]) return mapped[1];
  if (raw.includes(':')) return ipv6Network(raw);
  return raw;
}

export function rateLimitKey(identity: RateLimitIdentity, req: Request): string {
  if (identity === 'user') {
    const userId = req.user?.userId;
    if (userId && /^[A-Za-z0-9_-]{1,128}$/.test(userId)) return `user:${userId}`;
  }
  return `ip:${clientIp(req)}`;
}

function retryAfterSeconds(resetTime: Date | undefined, windowMs: number): number {
  if (!resetTime) return Math.max(1, Math.ceil(windowMs / 1000));
  return Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
}

function sendRateLimit(req: Request, res: Response, policy: RateLimitPolicy): void {
  const rated = req as Request & { rateLimit?: { resetTime?: Date } };
  const retryAfter = retryAfterSeconds(rated.rateLimit?.resetTime, policy.windowMs);
  res.setHeader('Retry-After', String(retryAfter));
  res.status(429).json({ error: policy.error, retryAfterSeconds: retryAfter });
}

function sendStoreUnavailable(res: Response): void {
  res.setHeader('Retry-After', '5');
  res.status(503).json({
    error: 'Shared rate limiting is unavailable. The request was rejected.',
    retryAfterSeconds: 5,
  });
}

export function createDistributedRateLimiter(
  policy: RateLimitPolicy,
  client?: RateLimitRedis
): RequestHandler {
  const limiter = rateLimit({
    windowMs: policy.windowMs,
    limit: policy.limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: policy.skipSuccessfulRequests === true,
    passOnStoreError: policy.failureMode === 'fail-open',
    requestPropertyName: 'rateLimit',
    keyGenerator: (req) => rateLimitKey(policy.identity, req),
    skip: (req) => {
      const path = req.originalUrl.split('?')[0];
      return path === '/health' || path === '/api/reviews/internal/verification-callback';
    },
    validate: {
      trustProxy: false,
      xForwardedForHeader: false,
    },
    handler: (req, res) => sendRateLimit(req, res, policy),
    store: new RedisRateLimitStore(
      policy.name,
      policy.failureMode,
      client ? () => client : getRateLimitRedis
    ),
  });

  return (req, res, next) => {
    limiter(req, res, (error?: unknown) => {
      if (
        policy.failureMode === 'fail-closed' &&
        (error instanceof RateLimitUnavailableError ||
          (error instanceof Error && error.name === 'RateLimitUnavailableError'))
      ) {
        sendStoreUnavailable(res);
        return;
      }
      next(error);
    });
  };
}

export const apiLimiter = createDistributedRateLimiter(rateLimitPolicies.api);
export const loginRegistrationLimiter = createDistributedRateLimiter(
  rateLimitPolicies.loginRegistration
);
export const accountSecurityLimiter = createDistributedRateLimiter(
  rateLimitPolicies.accountSecurity
);
export const emailVerificationLimiter = createDistributedRateLimiter(
  rateLimitPolicies.emailVerification
);
export const manualReviewLimiter = createDistributedRateLimiter(rateLimitPolicies.manualReview);
export const repositoryQaLimiter = createDistributedRateLimiter(rateLimitPolicies.repositoryQa);
export const automationLimiter = createDistributedRateLimiter(rateLimitPolicies.automation);
export const automationUserLimiter = createDistributedRateLimiter(rateLimitPolicies.automationUser);
export const aiGenerationLimiter = createDistributedRateLimiter(rateLimitPolicies.aiGeneration);
export const githubLimiter = createDistributedRateLimiter(rateLimitPolicies.github);
export const integrationLimiter = createDistributedRateLimiter(rateLimitPolicies.integration);
export const socialLimiter = createDistributedRateLimiter(rateLimitPolicies.social);
export const workspaceInvitationEmailLimiter = createDistributedRateLimiter(
  rateLimitPolicies.workspaceInvitationEmail
);
