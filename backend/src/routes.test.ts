import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';

process.env.STRIPE_SECRET_KEY = 'sk_test_route_wiring';
const { createApiRoutes } = await import('./routes');

test('mounts protected API routes and rejects requests without a valid token', async (context) => {
  const app = express();
  app.use('/api', createApiRoutes());
  const server = app.listen(0);
  await once(server, 'listening');
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  );

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const protectedRequests: Array<[string, RequestInit?]> = [
    ['/auth/me'],
    ['/github/repos'],
    ['/github/development/templates'],
    [
      '/github/development/workflows',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ],
    ['/reviews'],
    ['/reviews/analytics'],
    ['/reviews/findings/not-owned/status', { method: 'PATCH' }],
    ['/reviews/findings/not-owned/verification-requests', { method: 'POST' }],
    ['/reviews/findings/not-owned/verification-requests/request-1', { method: 'GET' }],
    ['/billing/usage'],
    ['/chat/message', { method: 'POST' }],
    ['/automations'],
    ['/automations', { method: 'POST' }],
    ['/automations/not-owned/reject', { method: 'POST' }],
    ['/automations/not-owned/approve', { method: 'POST' }],
    ['/social/status'],
    ['/integrations'],
    ['/integrations/github/check', { method: 'POST' }],
    ['/social/posts'],
    ['/social/linkedin/connect', { method: 'POST' }],
    ['/social/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    ['/social/drafts/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    ['/social/posts/not-owned/approve', { method: 'POST' }],
    ['/social/posts/not-owned/retry', { method: 'POST' }],
  ];

  for (const [path, options] of protectedRequests) {
    const response = await fetch(`${baseUrl}${path}`, options);
    assert.equal(response.status, 401, `${path} should require authentication`);
  }
});
