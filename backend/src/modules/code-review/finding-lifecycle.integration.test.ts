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
    const [
      { prisma },
      { FindingLifecycleService },
      { FixVerificationLimitError, FixVerificationService },
      { ReviewService },
      { default: reviewRoutes },
    ] = await Promise.all([
      import('@/config/database'),
      import('./finding-lifecycle.service'),
      import('./fix-verification.service'),
      import('./review.service'),
      import('./review.routes'),
    ])
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

      const proposalPatch = [
        'diff --git a/src/index.ts b/src/index.ts',
        '--- a/src/index.ts',
        '+++ b/src/index.ts',
        '@@ -1 +1 @@',
        '-old()',
        '+new()',
      ].join('\n')
      const otherProposal = await fetch(`${baseUrl}/findings/${findingId}/fix-proposals`, {
        method: 'POST',
        headers: authHeaders(otherUserToken),
        body: JSON.stringify({ patch: proposalPatch }),
      })
      assert.equal(otherProposal.status, 404)

      const invalidProposal = await fetch(`${baseUrl}/findings/${findingId}/fix-proposals`, {
        method: 'POST',
        headers: authHeaders(ownerToken),
        body: JSON.stringify({ patch: 'not a unified diff' }),
      })
      assert.equal(invalidProposal.status, 400)

      const createdProposal = await fetch(`${baseUrl}/findings/${findingId}/fix-proposals`, {
        method: 'POST',
        headers: authHeaders(ownerToken),
        body: JSON.stringify({ patch: proposalPatch }),
      })
      assert.equal(createdProposal.status, 201)
      const proposalBody = (await createdProposal.json()) as {
        proposal: { id: string; patch: string; patchSha256: string }
      }
      assert.equal(proposalBody.proposal.patch, proposalPatch)
      assert.match(proposalBody.proposal.patchSha256, /^[a-f0-9]{64}$/)

      const retriedProposal = await fetch(`${baseUrl}/findings/${findingId}/fix-proposals`, {
        method: 'POST',
        headers: authHeaders(ownerToken),
        body: JSON.stringify({ patch: proposalPatch }),
      })
      assert.equal(retriedProposal.status, 201)
      const retriedProposalBody = (await retriedProposal.json()) as {
        proposal: { id: string }
      }
      assert.equal(retriedProposalBody.proposal.id, proposalBody.proposal.id)
      for (let index = 1; index < 10; index += 1) {
        const distinctPatch = proposalPatch.replace('old()', `old${index}()`)
        const additionalProposal = await fetch(
          `${baseUrl}/findings/${findingId}/fix-proposals`,
          {
            method: 'POST',
            headers: authHeaders(ownerToken),
            body: JSON.stringify({ patch: distinctPatch }),
          }
        )
        assert.equal(additionalProposal.status, 201)
      }
      const overLimitProposal = await fetch(`${baseUrl}/findings/${findingId}/fix-proposals`, {
        method: 'POST',
        headers: authHeaders(ownerToken),
        body: JSON.stringify({ patch: proposalPatch.replace('old()', 'old10()') }),
      })
      assert.equal(overLimitProposal.status, 409)
      const persistedProposal = await prisma.fixProposal.findUniqueOrThrow({
        where: { id: proposalBody.proposal.id },
      })
      assert.equal(persistedProposal.userId, ownerId)
      assert.equal(persistedProposal.patchSha256, proposalBody.proposal.patchSha256)

      const verificationService = new FixVerificationService(undefined, {
        async execute({ patchSha256 }) {
          return {
            patchSha256,
            executionStatus: 'SUCCEEDED',
            testCommands: ['test-only synthetic runner result'],
            testsPassed: true,
            originalIssueReproducedBefore: true,
            originalIssueReproducedAfter: false,
            sanitizedLogs: 'synthetic result; no repository command executed',
          }
        },
      })
      await assert.rejects(
        verificationService.verifyProposal(
          otherUserId,
          proposalBody.proposal.id,
          'unauthorized-verification'
        ),
        /Finding not found/
      )
      const simulatedVerification = await verificationService.verifyProposal(
        ownerId,
        proposalBody.proposal.id,
        'integration-verification-result'
      )
      assert.equal(simulatedVerification.status, 'VERIFIED')
      assert.equal(simulatedVerification.patchSha256, proposalBody.proposal.patchSha256)
      assert.ok(simulatedVerification.startedAt instanceof Date)
      assert.ok(simulatedVerification.completedAt instanceof Date)
      assert.deepEqual(simulatedVerification.testCommands, ['test-only synthetic runner result'])
      assert.match(simulatedVerification.sanitizedLogs ?? '', /no repository command executed/)
      const persistedAttempt = await prisma.fixVerificationAttempt.findUniqueOrThrow({
        where: { id: simulatedVerification.id },
      })
      assert.equal(persistedAttempt.requestedById, ownerId)
      assert.equal(persistedAttempt.status, 'VERIFIED')
      assert.equal(persistedAttempt.patchSha256, proposalBody.proposal.patchSha256)
      assert.ok(persistedAttempt.completedAt instanceof Date)
      assert.deepEqual(persistedAttempt.testCommands, ['test-only synthetic runner result'])
      assert.equal(
        (await prisma.finding.findUniqueOrThrow({ where: { id: findingId } }))
          .independentlyVerifiedAt,
        null
      )
      const clientVerificationResult = await fetch(
        `${baseUrl}/findings/${findingId}/verification-requests`,
        {
          method: 'POST',
          headers: authHeaders(ownerToken),
          body: JSON.stringify({
            requestKey: 'client-forged-result',
            method: 'STATIC_ANALYSIS',
            status: 'VERIFIED',
            executionOccurred: true,
            exitCode: 0,
            sourceRevision: 'a'.repeat(40),
          }),
        }
      )
      assert.equal(clientVerificationResult.status, 400)
      const verificationRequest = () =>
        fetch(`${baseUrl}/findings/${findingId}/verification-requests`, {
          method: 'POST',
          headers: authHeaders(ownerToken),
          body: JSON.stringify({
            requestKey: 'persisted-independent-check',
            method: 'STATIC_ANALYSIS',
          }),
        })
      const firstVerificationRequest = await verificationRequest()
      assert.equal(firstVerificationRequest.status, 200)
      const firstVerificationBody = await firstVerificationRequest.json()
      assert.equal(firstVerificationBody.verification.status, 'INCONCLUSIVE')
      assert.equal(firstVerificationBody.verification.executionOccurred, false)
      assert.equal(firstVerificationBody.verification.toolIdentity, null)
      assert.equal(firstVerificationBody.verification.sourceRevision, null)

      const repeatedVerificationRequest = await verificationRequest()
      assert.equal(repeatedVerificationRequest.status, 200)
      const repeatedVerificationBody = await repeatedVerificationRequest.json()
      assert.equal(
        repeatedVerificationBody.verification.id,
        firstVerificationBody.verification.id
      )
      const inspectedVerification = await fetch(
        `${baseUrl}/findings/${findingId}/verification-requests/persisted-independent-check`,
        { headers: authHeaders(ownerToken) }
      )
      assert.equal(inspectedVerification.status, 200)
      const inspectedVerificationBody = await inspectedVerification.json()
      assert.equal(
        inspectedVerificationBody.verification.id,
        firstVerificationBody.verification.id
      )
      const otherUserVerification = await fetch(
        `${baseUrl}/findings/${findingId}/verification-requests/persisted-independent-check`,
        { headers: authHeaders(otherUserToken) }
      )
      assert.equal(otherUserVerification.status, 404)

      const duplicateVerification = await verificationService.verifyProposal(
        ownerId,
        proposalBody.proposal.id,
        'integration-verification-result'
      )
      assert.equal(duplicateVerification.id, simulatedVerification.id)
      assert.equal(
        await prisma.fixVerificationAttempt.count({
          where: { proposalId: proposalBody.proposal.id },
        }),
        1
      )
      for (let index = 1; index < 5; index += 1) {
        await verificationService.verifyProposal(
          ownerId,
          proposalBody.proposal.id,
          `integration-verification-${index}`
        )
      }
      await assert.rejects(
        verificationService.verifyProposal(
          ownerId,
          proposalBody.proposal.id,
          'verification-over-limit'
        ),
        FixVerificationLimitError
      )

      const attemptedVerificationEvidence = await fetch(
        `${baseUrl}/findings/${findingId}/status`,
        {
          method: 'PATCH',
          headers: authHeaders(ownerToken),
          body: JSON.stringify({
            status: 'FIXED',
            independentlyVerifiedAt: new Date().toISOString(),
            verificationStatus: 'VERIFIED',
          }),
        }
      )
      assert.equal(attemptedVerificationEvidence.status, 400)

      const updatedAtStart = Date.now()
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
      const savedPatchProposal = ownedDetail.findings[0]?.fixProposals.find(
        (proposal) => proposal.patch === proposalPatch
      )
      assert.ok(savedPatchProposal)
      assert.equal(savedPatchProposal.attempts.length, 5)
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
