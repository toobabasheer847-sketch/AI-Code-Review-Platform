import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';

const testDatabaseUrl = process.env.FINDING_LIFECYCLE_TEST_DATABASE_URL;
if (testDatabaseUrl) {
  const target = new URL(testDatabaseUrl);
  const databaseName = target.pathname.slice(1);
  if (
    !['localhost', '127.0.0.1', '::1'].includes(target.hostname) ||
    !/(test|lifecycle)/i.test(databaseName) ||
    testDatabaseUrl !== process.env.DATABASE_URL
  ) {
    throw new Error(
      'Finding lifecycle integration tests require DATABASE_URL to match a localhost test/lifecycle database.'
    );
  }
}

test(
  'finding lifecycle persists owner-scoped feedback atomically and serves it through the API',
  { skip: !testDatabaseUrl },
  async (context) => {
    const [{ prisma }, { FindingLifecycleService }, { ReviewService }, { default: reviewRoutes }] =
      await Promise.all([
        import('@/config/database'),
        import('./finding-lifecycle.service'),
        import('./review.service'),
        import('./review.routes'),
      ]);
    const { generateToken } = await import('@/utils/jwt');
    const ownerId = randomUUID();
    const otherUserId = randomUUID();
    const repositoryId = randomUUID();
    const reviewId = randomUUID();
    const findingId = randomUUID();
    const ids = [ownerId, otherUserId];
    const lifecycleService = new FindingLifecycleService();
    const reviewService = new ReviewService();
    const app = express();
    app.use(express.json());
    app.use('/api/reviews', reviewRoutes);
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
    const baseUrl = `http://127.0.0.1:${address.port}/api/reviews`;
    const ownerToken = generateToken({
      userId: ownerId,
      email: `${ownerId}@example.test`,
      tokenVersion: 0,
    });
    const otherUserToken = generateToken({
      userId: otherUserId,
      email: `${otherUserId}@example.test`,
      tokenVersion: 0,
    });
    const authHeaders = (token: string) => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
    const triggerSuffix = randomUUID().replace(/-/g, '');
    const triggerName = `phase19_reject_feedback_${triggerSuffix}`;
    const functionName = `phase19_reject_feedback_fn_${triggerSuffix}`;
    let triggerInstalled = false;

    try {
      await prisma.user.createMany({
        data: [
          {
            id: ownerId,
            email: `${ownerId}@example.test`,
            fullName: 'Lifecycle Owner',
            passwordHash: 'integration-test-hash',
            isVerified: true,
          },
          {
            id: otherUserId,
            email: `${otherUserId}@example.test`,
            fullName: 'Other User',
            passwordHash: 'integration-test-hash',
            isVerified: true,
          },
        ],
      });
      await prisma.repository.create({
        data: {
          id: repositoryId,
          userId: ownerId,
          name: 'owner/repository',
          url: `https://example.test/${repositoryId}`,
        },
      });
      await prisma.codeReview.create({
        data: {
          id: reviewId,
          userId: ownerId,
          repositoryId,
          title: 'Lifecycle integration review',
          fileContent: 'const issue = true;',
          status: 'completed',
        },
      });
      await prisma.finding.create({
        data: {
          id: findingId,
          reviewId,
          file: 'src/index.ts',
          line: 1,
          message: 'Integration finding',
          severity: 'warning',
          suggestions: [],
        },
      });

      const initialRead = await fetch(`${baseUrl}/${reviewId}`, {
        headers: authHeaders(ownerToken),
      });
      assert.equal(initialRead.status, 200);
      const initialReview = (await initialRead.json()) as {
        findings: Array<{ id: string; status: string; feedback: unknown[] }>;
      };
      assert.equal(initialReview.findings.length, 1);
      assert.equal(initialReview.findings[0]?.id, findingId);
      assert.equal(initialReview.findings[0]?.status, 'UNREVIEWED');
      assert.deepEqual(initialReview.findings[0]?.feedback, []);

      const otherRead = await fetch(`${baseUrl}/${reviewId}`, {
        headers: authHeaders(otherUserToken),
      });
      assert.equal(otherRead.status, 404);

      const otherUpdate = await fetch(`${baseUrl}/findings/${findingId}/status`, {
        method: 'PATCH',
        headers: authHeaders(otherUserToken),
        body: JSON.stringify({ status: 'FIXED', reason: 'Unauthorized attempt' }),
      });
      assert.equal(otherUpdate.status, 404);
      assert.equal(await prisma.findingFeedback.count({ where: { findingId } }), 0);

      const invalidInput = await fetch(`${baseUrl}/findings/${findingId}/status`, {
        method: 'PATCH',
        headers: authHeaders(ownerToken),
        body: JSON.stringify({ status: 'UNKNOWN' }),
      });
      assert.equal(invalidInput.status, 400);

      const updatedAtStart = Date.now();
      const firstUpdate = await fetch(`${baseUrl}/findings/${findingId}/status`, {
        method: 'PATCH',
        headers: authHeaders(ownerToken),
        body: JSON.stringify({ status: 'CONFIRMED', reason: 'Checked the call path.' }),
      });
      assert.equal(firstUpdate.status, 200);
      const firstFeedback = (await firstUpdate.json()) as {
        feedback: { userId: string; previousStatus: string; status: string; reason: string; createdAt: string };
      };
      assert.equal(firstFeedback.feedback.userId, ownerId);
      assert.equal(firstFeedback.feedback.previousStatus, 'UNREVIEWED');
      assert.equal(firstFeedback.feedback.status, 'CONFIRMED');
      assert.equal(firstFeedback.feedback.reason, 'Checked the call path.');
      assert.ok(Date.parse(firstFeedback.feedback.createdAt) >= updatedAtStart);

      const secondUpdate = await lifecycleService.updateStatus(ownerId, findingId, 'FIXED');
      assert.equal(secondUpdate.previousStatus, 'CONFIRMED');
      assert.equal(secondUpdate.status, 'FIXED');
      assert.equal(secondUpdate.reason, null);

      const persisted = await prisma.finding.findUniqueOrThrow({
        where: { id: findingId },
        include: { feedback: { orderBy: { createdAt: 'asc' }, include: { user: true } } },
      });
      assert.equal(persisted.status, 'FIXED');
      assert.equal(persisted.feedback.length, 2);
      assert.equal(persisted.feedback[1]?.user.fullName, 'Lifecycle Owner');
      assert.equal(persisted.feedback[1]?.reason, null);

      await assert.rejects(
        lifecycleService.updateStatus(ownerId, findingId, 'FALSE_POSITIVE'),
        /Cannot change finding status from FIXED to FALSE_POSITIVE/
      );
      const unchangedHistoryCount = await prisma.findingFeedback.count({ where: { findingId } });
      assert.equal(unchangedHistoryCount, 2);
      const invalidTransition = await fetch(`${baseUrl}/findings/${findingId}/status`, {
        method: 'PATCH',
        headers: authHeaders(ownerToken),
        body: JSON.stringify({ status: 'FALSE_POSITIVE' }),
      });
      assert.equal(invalidTransition.status, 409);

      const ownedDetail = await reviewService.getReview(ownerId, reviewId);
      assert.equal(ownedDetail.findings[0]?.feedback.length, 2);
      assert.deepEqual(ownedDetail.findingLifecycleAnalytics, {
        total: 1,
        statusCounts: {
          UNREVIEWED: 0,
          CONFIRMED: 0,
          FALSE_POSITIVE: 0,
          DUPLICATE: 0,
          FIXED: 1,
          WONT_FIX: 0,
        },
        developerMarkedFixed: 1,
        independentlyVerifiedFixed: 0,
      });

      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "${functionName}"() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'intentional lifecycle integration rollback';
        END;
        $$;
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE INSERT ON "FindingFeedback"
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
      `);
      triggerInstalled = true;

      await assert.rejects(
        lifecycleService.updateStatus(ownerId, findingId, 'CONFIRMED', 'force rollback')
      );
      const afterRollback = await prisma.finding.findUniqueOrThrow({
        where: { id: findingId },
        include: { feedback: true },
      });
      assert.equal(afterRollback.status, 'FIXED');
      assert.equal(afterRollback.feedback.length, 2);
    } finally {
      if (triggerInstalled) {
        await prisma.$executeRawUnsafe(`DROP TRIGGER "${triggerName}" ON "FindingFeedback";`);
      }
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await prisma.$disconnect();
    }
  }
);
