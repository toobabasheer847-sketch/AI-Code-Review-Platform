import assert from 'node:assert/strict';
import express, { type Express, type Request } from 'express';
import test from 'node:test';
import {
  createDistributedRateLimiter,
  rateLimitKey,
  rateLimitPolicies,
  readRateLimitBound,
  resolveTrustProxySetting,
} from './rate-limit';
import {
  RATE_LIMIT_DECREMENT_SCRIPT,
  RATE_LIMIT_INCREMENT_SCRIPT,
  createMemoryRateLimitRedis,
  createUnavailableRateLimitRedis,
  type RateLimitRedis,
} from './rate-limit.redis';

function attachUser(req: Request): void {
  const userId = req.header('x-user');
  if (userId) req.user = { userId, email: `${userId}@example.test` };
}

async function listen(app: Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function request(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
  method = 'GET'
): Promise<{ status: number; retryAfter: string | null; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, { method, headers });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = text;
  }
  return { status: response.status, retryAfter: response.headers.get('retry-after'), body };
}

test('keeps the existing ceilings and rejects configuration that would weaken them', () => {
  assert.equal(rateLimitPolicies.api.limit, 100);
  assert.equal(rateLimitPolicies.api.windowMs, 15 * 60 * 1000);
  assert.equal(rateLimitPolicies.loginRegistration.limit, 5);
  assert.equal(rateLimitPolicies.loginRegistration.skipSuccessfulRequests, true);
  assert.equal(rateLimitPolicies.accountSecurity.limit, 5);
  assert.equal(rateLimitPolicies.emailVerification.limit, 10);
  assert.equal(rateLimitPolicies.automation.limit, 10);
  assert.equal(rateLimitPolicies.automation.windowMs, 60_000);
  assert.equal(rateLimitPolicies.github.limit, 30);
  assert.equal(rateLimitPolicies.integration.limit, 20);
  assert.equal(rateLimitPolicies.social.limit, 20);
  assert.equal(rateLimitPolicies.workspaceInvitationEmail.limit, 10);
  assert.equal(rateLimitPolicies.workspaceInvitationEmail.windowMs, 15 * 60 * 1000);
  assert.equal(rateLimitPolicies.workspaceInvitationEmail.identity, 'user');
  assert.equal(rateLimitPolicies.workspaceInvitationEmail.failureMode, 'fail-closed');
  assert.equal(rateLimitPolicies.workspaceInvitationEmail.error, 'Too many invitation emails. Try again later.');
  assert.equal(rateLimitPolicies.manualReview.failureMode, 'fail-closed');
  assert.equal(rateLimitPolicies.repositoryQa.failureMode, 'fail-closed');
  assert.equal(rateLimitPolicies.aiGeneration.failureMode, 'fail-closed');
  assert.equal(rateLimitPolicies.api.failureMode, 'fail-open');
  const previousMax = process.env.RATE_LIMIT_LOGIN_MAX;
  const previousWindow = process.env.RATE_LIMIT_LOGIN_WINDOW_MS;
  try {
    process.env.RATE_LIMIT_LOGIN_MAX = '4';
    assert.equal(readRateLimitBound('RATE_LIMIT_LOGIN_MAX', 5, 1, 5), 4);
    process.env.RATE_LIMIT_LOGIN_MAX = '6';
    assert.throws(() => readRateLimitBound('RATE_LIMIT_LOGIN_MAX', 5, 1, 5), /cannot weaken/);
    process.env.RATE_LIMIT_LOGIN_WINDOW_MS = '1000';
    assert.throws(
      () => readRateLimitBound('RATE_LIMIT_LOGIN_WINDOW_MS', 900_000, 900_000, 86_400_000),
      /cannot weaken/
    );
  } finally {
    if (previousMax === undefined) delete process.env.RATE_LIMIT_LOGIN_MAX;
    else process.env.RATE_LIMIT_LOGIN_MAX = previousMax;
    if (previousWindow === undefined) delete process.env.RATE_LIMIT_LOGIN_WINDOW_MS;
    else process.env.RATE_LIMIT_LOGIN_WINDOW_MS = previousWindow;
  }
  assert.match(RATE_LIMIT_INCREMENT_SCRIPT, /INCR/);
  assert.match(RATE_LIMIT_INCREMENT_SCRIPT, /PEXPIRE/);
  assert.match(RATE_LIMIT_DECREMENT_SCRIPT, /DECR/);
});

test('workspace invitation emails are limited per user', async () => {
  const redis = createMemoryRateLimitRedis();
  const app = express();
  app.set('trust proxy', false);
  app.use((req, _res, next) => {
    attachUser(req);
    next();
  });
  app.use(
    createDistributedRateLimiter(
      { ...rateLimitPolicies.workspaceInvitationEmail, limit: 1, windowMs: 60_000 },
      redis
    )
  );
  app.post('/resend', (_req, res) => res.sendStatus(201));
  const server = await listen(app);
  try {
    const first = await request(server.baseUrl, '/resend', { 'x-user': 'owner-a' }, 'POST');
    const repeat = await request(server.baseUrl, '/resend', { 'x-user': 'owner-a' }, 'POST');
    const otherUser = await request(server.baseUrl, '/resend', { 'x-user': 'owner-b' }, 'POST');
    assert.equal(first.status, 201);
    assert.equal(repeat.status, 429);
    assert.equal(otherUser.status, 201);
    assert.deepEqual(repeat.body, {
      error: rateLimitPolicies.workspaceInvitationEmail.error,
      retryAfterSeconds: Number(repeat.retryAfter),
    });
    assert.equal(JSON.stringify(repeat.body).includes('token'), false);
  } finally {
    await server.close();
  }
});

test('trusts only an explicit proxy hop count', () => {
  assert.equal(resolveTrustProxySetting(undefined), false);
  assert.equal(resolveTrustProxySetting(''), false);
  assert.equal(resolveTrustProxySetting('false'), false);
  assert.equal(resolveTrustProxySetting('1'), 1);
  assert.equal(resolveTrustProxySetting('2'), 2);
  assert.throws(() => resolveTrustProxySetting('true'), /spoof X-Forwarded-For/);
  assert.throws(() => resolveTrustProxySetting('all'), /spoof X-Forwarded-For/);
  assert.throws(() => resolveTrustProxySetting('6'), /1 to 5/);
});

test('two limiters share one Redis counter and a new limiter keeps it after restart', async () => {
  const redis = createMemoryRateLimitRedis();
  const policy = { ...rateLimitPolicies.api, limit: 3, windowMs: 60_000 };
  const firstApp = express();
  firstApp.set('trust proxy', false);
  firstApp.use(createDistributedRateLimiter(policy, redis));
  firstApp.get('/', (_req, res) => res.sendStatus(200));
  const secondApp = express();
  secondApp.set('trust proxy', false);
  secondApp.use(createDistributedRateLimiter(policy, redis));
  secondApp.get('/', (_req, res) => res.sendStatus(200));
  const first = await listen(firstApp);
  const second = await listen(secondApp);
  try {
    assert.equal((await request(first.baseUrl, '/')).status, 200);
    assert.equal((await request(second.baseUrl, '/')).status, 200);
    const restartedApp = express();
    restartedApp.set('trust proxy', false);
    restartedApp.use(createDistributedRateLimiter(policy, redis));
    restartedApp.get('/', (_req, res) => res.sendStatus(200));
    const restarted = await listen(restartedApp);
    try {
      assert.equal((await request(restarted.baseUrl, '/')).status, 200);
      const blocked = await request(first.baseUrl, '/');
      assert.equal(blocked.status, 429);
      assert.match(blocked.retryAfter ?? '', /^[1-9]\d*$/);
      assert.deepEqual(blocked.body, {
        error: rateLimitPolicies.api.error,
        retryAfterSeconds: Number(blocked.retryAfter),
      });
    } finally {
      await restarted.close();
    }
  } finally {
    await first.close();
    await second.close();
  }
});

test('ignores spoofed forwarded addresses unless a trusted hop count is configured', async () => {
  const redis = createMemoryRateLimitRedis();
  const policy = {
    ...rateLimitPolicies.loginRegistration,
    limit: 1,
    skipSuccessfulRequests: false,
  };
  const untrusted = express();
  untrusted.set('trust proxy', resolveTrustProxySetting('false'));
  untrusted.use(createDistributedRateLimiter(policy, redis));
  untrusted.get('/', (req, res) => res.json({ ip: req.ip }));
  const direct = await listen(untrusted);
  try {
    const first = await request(direct.baseUrl, '/', { 'x-forwarded-for': '203.0.113.10' });
    const spoofed = await request(direct.baseUrl, '/', { 'x-forwarded-for': '198.51.100.20' });
    assert.equal(first.status, 200);
    assert.equal(spoofed.status, 429);
    assert.equal(JSON.stringify(first.body).includes('203.0.113.10'), false);
  } finally {
    await direct.close();
  }

  const trustedRedis = createMemoryRateLimitRedis();
  const trusted = express();
  trusted.set('trust proxy', resolveTrustProxySetting('1'));
  trusted.use(createDistributedRateLimiter(policy, trustedRedis));
  trusted.get('/', (_req, res) => res.sendStatus(200));
  const proxied = await listen(trusted);
  try {
    assert.equal(
      (await request(proxied.baseUrl, '/', { 'x-forwarded-for': '9.9.9.9, 203.0.113.10' })).status,
      200
    );
    assert.equal(
      (await request(proxied.baseUrl, '/', { 'x-forwarded-for': '8.8.8.8, 203.0.113.10' })).status,
      429
    );
    assert.equal(
      (await request(proxied.baseUrl, '/', { 'x-forwarded-for': '9.9.9.9, 198.51.100.20' })).status,
      200
    );
  } finally {
    await proxied.close();
  }
});

test('limits authenticated users independently of the calling address', async () => {
  const redis = createMemoryRateLimitRedis();
  const app = express();
  app.set('trust proxy', resolveTrustProxySetting('1'));
  app.use((req, _res, next) => {
    attachUser(req);
    next();
  });
  app.use(createDistributedRateLimiter({ ...rateLimitPolicies.manualReview, limit: 1 }, redis));
  app.post('/reviews/start', (_req, res) => res.sendStatus(202));
  const server = await listen(app);
  try {
    assert.equal(
      (
        await request(
          server.baseUrl,
          '/reviews/start',
          { 'x-user': 'user-a', 'x-forwarded-for': '203.0.113.10' },
          'POST'
        )
      ).status,
      202
    );
    assert.equal(
      (
        await request(
          server.baseUrl,
          '/reviews/start',
          { 'x-user': 'user-a', 'x-forwarded-for': '198.51.100.20' },
          'POST'
        )
      ).status,
      429
    );
    assert.equal(
      (
        await request(
          server.baseUrl,
          '/reviews/start',
          { 'x-user': 'user-b', 'x-forwarded-for': '198.51.100.20' },
          'POST'
        )
      ).status,
      202
    );
    const requestWithUser = { user: { userId: 'user-a', email: 'a@example.test' } } as Request;
    assert.equal(rateLimitKey('user', requestWithUser), 'user:user-a');
  } finally {
    await server.close();
  }
});

test('auth and expensive AI policies do not consume each other', async () => {
  const redis = createMemoryRateLimitRedis();
  const app = express();
  app.set('trust proxy', false);
  app.use((req, _res, next) => {
    attachUser(req);
    next();
  });
  app.post(
    '/login',
    createDistributedRateLimiter(
      { ...rateLimitPolicies.loginRegistration, limit: 1, skipSuccessfulRequests: false },
      redis
    ),
    (_req, res) => res.sendStatus(401)
  );
  app.post(
    '/password-reset',
    createDistributedRateLimiter({ ...rateLimitPolicies.accountSecurity, limit: 1 }, redis),
    (_req, res) => res.sendStatus(202)
  );
  app.post(
    '/reviews/start',
    createDistributedRateLimiter({ ...rateLimitPolicies.manualReview, limit: 1 }, redis),
    (_req, res) => res.sendStatus(202)
  );
  app.post(
    '/repository-qa',
    createDistributedRateLimiter({ ...rateLimitPolicies.repositoryQa, limit: 1 }, redis),
    (_req, res) => res.sendStatus(200)
  );
  app.post(
    '/ai',
    createDistributedRateLimiter({ ...rateLimitPolicies.aiGeneration, limit: 1 }, redis),
    (_req, res) => res.sendStatus(200)
  );
  const server = await listen(app);
  const user = { 'x-user': 'owner-1' };
  try {
    assert.equal((await request(server.baseUrl, '/login', {}, 'POST')).status, 401);
    assert.equal((await request(server.baseUrl, '/login', {}, 'POST')).status, 429);
    assert.equal((await request(server.baseUrl, '/password-reset', {}, 'POST')).status, 202);
    assert.equal((await request(server.baseUrl, '/reviews/start', user, 'POST')).status, 202);
    assert.equal((await request(server.baseUrl, '/reviews/start', user, 'POST')).status, 429);
    assert.equal((await request(server.baseUrl, '/repository-qa', user, 'POST')).status, 200);
    assert.equal((await request(server.baseUrl, '/ai', user, 'POST')).status, 200);
    assert.equal((await request(server.baseUrl, '/repository-qa', user, 'POST')).status, 429);
    assert.equal((await request(server.baseUrl, '/ai', user, 'POST')).status, 429);
  } finally {
    await server.close();
  }
});

test('does not count successful login attempts, and rejects requests when Redis is down', async () => {
  const redis = createMemoryRateLimitRedis();
  const app = express();
  app.set('trust proxy', false);
  app.post(
    '/login',
    createDistributedRateLimiter(rateLimitPolicies.loginRegistration, redis),
    (req, res) => {
      res.sendStatus(req.header('x-fail') === '1' ? 401 : 200);
    }
  );
  const server = await listen(app);
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      assert.equal((await request(server.baseUrl, '/login', {}, 'POST')).status, 200);
      await new Promise((resolve) => setImmediate(resolve));
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal(
        (await request(server.baseUrl, '/login', { 'x-fail': '1' }, 'POST')).status,
        401
      );
    }
    const blocked = await request(server.baseUrl, '/login', { 'x-fail': '1' }, 'POST');
    assert.equal(blocked.status, 429);
    assert.ok(blocked.retryAfter);
  } finally {
    await server.close();
  }

  const closed = express();
  closed.set('trust proxy', false);
  closed.post(
    '/reviews/start',
    createDistributedRateLimiter(rateLimitPolicies.manualReview, createUnavailableRateLimitRedis()),
    (_req, res) => res.sendStatus(202)
  );
  const closedServer = await listen(closed);
  try {
    const rejected = await request(
      closedServer.baseUrl,
      '/reviews/start',
      { 'x-user': 'owner-1' },
      'POST'
    );
    assert.equal(rejected.status, 503);
    assert.equal(rejected.retryAfter, '5');
    assert.deepEqual(rejected.body, {
      error: 'Shared rate limiting is unavailable. The request was rejected.',
      retryAfterSeconds: 5,
    });
  } finally {
    await closedServer.close();
  }

  const open = express();
  open.set('trust proxy', false);
  open.use(
    createDistributedRateLimiter(
      { ...rateLimitPolicies.api, limit: 1 },
      createUnavailableRateLimitRedis()
    )
  );
  open.get('/api/ping', (_req, res) => res.sendStatus(200));
  const openServer = await listen(open);
  try {
    assert.equal((await request(openServer.baseUrl, '/api/ping')).status, 200);
    assert.equal((await request(openServer.baseUrl, '/api/ping')).status, 200);
  } finally {
    await openServer.close();
  }
});

test('does not rate limit health checks', async () => {
  const app = express();
  app.set('trust proxy', false);
  app.get('/health', (_req, res) => res.sendStatus(200));
  app.use(
    '/api',
    createDistributedRateLimiter(
      { ...rateLimitPolicies.api, limit: 1 },
      createMemoryRateLimitRedis()
    )
  );
  app.get('/api/ping', (_req, res) => res.sendStatus(200));
  const server = await listen(app);
  try {
    assert.equal((await request(server.baseUrl, '/health')).status, 200);
    assert.equal((await request(server.baseUrl, '/api/ping')).status, 200);
    assert.equal((await request(server.baseUrl, '/api/ping')).status, 429);
    assert.equal((await request(server.baseUrl, '/health')).status, 200);
  } finally {
    await server.close();
  }
});

test('records every shared increment through the Redis script', async () => {
  const calls: string[] = [];
  const inner = createMemoryRateLimitRedis();
  const redis: RateLimitRedis = {
    async evalScript(script, keys, args) {
      calls.push(script);
      return inner.evalScript(script, keys, args);
    },
  };
  const app = express();
  app.set('trust proxy', false);
  app.use(createDistributedRateLimiter({ ...rateLimitPolicies.api, limit: 1 }, redis));
  app.get('/', (_req, res) => res.sendStatus(200));
  const server = await listen(app);
  try {
    await request(server.baseUrl, '/');
    await request(server.baseUrl, '/');
  } finally {
    await server.close();
  }
  assert.equal(calls.length, 2);
  assert.equal(
    calls.every((script) => script === RATE_LIMIT_INCREMENT_SCRIPT),
    true
  );
});
