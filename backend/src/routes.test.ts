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
    ['/auth/logout', { method: 'POST' }],
    ['/auth/verification-email', { method: 'POST' }],
    ['/auth/account', { method: 'DELETE' }],
    ['/github/connect'],
    ['/github/disconnect', { method: 'DELETE' }],
    ['/github/repos'],
    ['/github/repos/owner/repository/files'],
    ['/github/repos/owner%2Frepository/files'],
    ['/github/file'],
    ['/github/development/templates'],
    [
      '/github/development/workflows',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ],
    ['/reviews'],
    ['/reviews/analytics'],
    ['/reviews/feedback-analytics'],
    ['/reviews/start', { method: 'POST' }],
    ['/reviews/review-1'],
    ['/reviews/review-1', { method: 'DELETE' }],
    ['/reviews/review-1/duplicate-candidates'],
    ['/reviews/review-1/findings/finding-1/test-suggestions', { method: 'POST' }],
    ['/reviews/findings/finding-1/fix-proposals', { method: 'POST' }],
    ['/reviews/fix-proposals/proposal-1/verification-attempts', { method: 'POST' }],
    ['/reviews/findings/finding-1/verification-requests', { method: 'POST' }],
    ['/reviews/findings/finding-1/verification-requests/request-1', { method: 'GET' }],
    ['/reviews/findings/finding-1/status', { method: 'PATCH' }],
    ['/repositories'],
    ['/repositories/repo-1/review-rules'],
    [
      '/repositories/repo-1/review-rules',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ],
    ['/repositories/repo-1/review-rules/rule-1', { method: 'PATCH' }],
    ['/repositories/repo-1/review-rules/rule-1', { method: 'DELETE' }],
    [
      '/reviews/findings/not-owned/feedback',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ],
    ['/reviews/fix-verification-attempts'],
    ['/reviews/fix-verification-attempts/attempt-1'],
    [
      '/reviews/fix-verification-attempts/attempt-1/review-decision',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ],
    ['/reviews/fix-verification-attempts/attempt-1/cancel', { method: 'POST' }],
    ['/reviews/findings/not-owned/status', { method: 'PATCH' }],
    ['/reviews/findings/not-owned/verification-requests', { method: 'POST' }],
    ['/reviews/findings/not-owned/verification-requests/request-1', { method: 'GET' }],
    ['/billing/usage'],
    ['/billing/subscription'],
    ['/billing/create-checkout', { method: 'POST' }],
    ['/billing/cancel-subscription', { method: 'POST' }],
    ['/ai-usage'],
    ['/chat/message', { method: 'POST' }],
    ['/chat/repository-message', { method: 'POST' }],
    ['/automations'],
    ['/automations', { method: 'POST' }],
    ['/automations/workflow-1'],
    ['/automations/visual', { method: 'POST' }],
    ['/automations/visual/validate', { method: 'POST' }],
    ['/automations/workflow-1/execute-draft', { method: 'POST' }],
    ['/automations/not-owned/reject', { method: 'POST' }],
    ['/automations/not-owned/approve', { method: 'POST' }],
    ['/automations/not-owned/cancel', { method: 'POST' }],
    ['/automations/not-owned/retry', { method: 'POST' }],
    ['/automations/schedules'],
    ['/automations/schedules', { method: 'POST' }],
    ['/automations/schedules/schedule-1', { method: 'PATCH' }],
    ['/automations/schedules/schedule-1/pause', { method: 'POST' }],
    ['/automations/schedules/schedule-1/resume', { method: 'POST' }],
    ['/automations/schedules/schedule-1', { method: 'DELETE' }],
    ['/automations/notification-preferences'],
    ['/automations/notification-preferences', { method: 'PUT' }],
    ['/social/status'],
    ['/social/linkedin/connect', { method: 'POST' }],
    ['/social/accounts/account-1', { method: 'DELETE' }],
    ['/integrations'],
    ['/integrations/github/check', { method: 'POST' }],
    ['/social/posts'],
    ['/social/posts/post-1', { method: 'PATCH' }],
    [
      '/social/drafts',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ],
    [
      '/social/drafts/generate',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ],
    ['/social/posts/not-owned/approve', { method: 'POST' }],
    ['/social/posts/not-owned/reject', { method: 'POST' }],
    ['/social/posts/not-owned/cancel', { method: 'POST' }],
    ['/social/posts/not-owned/retry', { method: 'POST' }],
    ['/social/posts/post-1/request-approval', { method: 'POST' }],
    ['/memory'],
    ['/memory', { method: 'POST' }],
    ['/memory/settings'],
    ['/memory/settings', { method: 'PATCH' }],
    ['/memory/projects'],
    ['/memory/memory-1', { method: 'PATCH' }],
    ['/memory/memory-1', { method: 'DELETE' }],
  ];

  for (const [path, options] of protectedRequests) {
    const response = await fetch(`${baseUrl}${path}`, options);
    assert.equal(response.status, 401, `${path} should require authentication`);
  }
});

test('does not expose documented placeholder API routes', async (context) => {
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
  const unimplementedRequests: Array<[string, RequestInit?]> = [
    ['/docs'],
    ['/ai/analyze', { method: 'POST' }],
    ['/ai/chat', { method: 'POST' }],
    ['/users'],
  ];

  for (const [path, options] of unimplementedRequests) {
    const response = await fetch(`${baseUrl}${path}`, options);
    assert.equal(response.status, 404, `${path} should remain unimplemented`);
  }
});

test('mounts public auth callbacks and webhook handlers without contacting providers', async (context) => {
  const app = express();
  app.use(express.json());
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
  const publicRequests: Array<[string, RequestInit?]> = [
    ['/auth/csrf'],
    ['/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    ['/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    [
      '/auth/verification-email/request',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ],
    ['/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    [
      '/auth/password-reset/request',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ],
    [
      '/auth/password-reset/confirm',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ],
    ['/github/callback'],
    ['/auth/github/callback'],
    ['/social/linkedin/callback', { redirect: 'manual' }],
    ['/billing/webhook', { method: 'POST' }],
    ['/webhooks/github', { method: 'POST' }],
    ['/reviews/internal/verification-callback', { method: 'POST' }],
  ];

  for (const [path, options] of publicRequests) {
    const response = await fetch(`${baseUrl}${path}`, options);
    assert.notEqual(response.status, 404, `${path} should be mounted`);
  }
});
