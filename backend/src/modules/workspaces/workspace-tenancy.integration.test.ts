import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import express from 'express'
import test from 'node:test'
import { AutomationMode, AutomationStatus, SocialPostStatus, SocialProvider, WorkspaceIntegrationProvider } from '@prisma/client'
import { resolveDisposableTestDatabaseUrl } from '@/testing/disposable-database'

const testDatabaseUrl = resolveDisposableTestDatabaseUrl()

test(
  'workspace APIs and background jobs isolate records by active workspace membership',
  { skip: !testDatabaseUrl },
  async () => {
    const [
      { prisma },
      { env },
      { generateToken },
      { encrypt },
      { loadAutomationJob },
      { findReviewForProcessing },
      { SocialService },
      { default: automationRoutes },
      { default: socialRoutes },
      { default: integrationsRoutes },
      { default: billingRoutes },
    ] = await Promise.all([
      import('@/config/database'),
      import('@/config/env'),
      import('@/utils/jwt'),
      import('@/utils/crypto'),
      import('@/modules/automation/automation.worker'),
      import('@/jobs/review.worker-store'),
      import('@/modules/social/social.service'),
      import('@/modules/automation/automation.routes'),
      import('@/modules/social/social.routes'),
      import('@/modules/integrations/integrations.routes'),
      import('@/modules/billing/billing.routes'),
    ])
    const suffix = randomUUID()
    const ownerAId = `owner-a-${suffix}`
    const ownerBId = `owner-b-${suffix}`
    const memberAId = `member-a-${suffix}`
    const viewerAId = `viewer-a-${suffix}`
    const suspendedAId = `suspended-a-${suffix}`
    const workspaceAId = `workspace-a-${suffix}`
    const workspaceBId = `workspace-b-${suffix}`
    const organizationAId = `organization-a-${suffix}`
    const organizationBId = `organization-b-${suffix}`
    const repositoryId = `repository-${suffix}`
    const foreignReviewId = `foreign-review-${suffix}`
    const userIds = [ownerAId, ownerBId, memberAId, viewerAId, suspendedAId]
    const organizationIds = [organizationAId, organizationBId]
    const app = express()
    app.use(express.json())
    app.use('/api/automations', automationRoutes)
    app.use('/api/social', socialRoutes)
    app.use('/api/integrations', integrationsRoutes)
    app.use('/api/billing', billingRoutes)
    const server = app.listen(0)
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}/api`

    const tokenFor = (userId: string) =>
      generateToken({ userId, email: `${userId}@example.test`, tokenVersion: 0 })
    const headersFor = (userId: string, workspaceId?: string) => ({
      Cookie: `${env.AUTH_SESSION_COOKIE_NAME}=${tokenFor(userId)}`,
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
    })

    try {
      await prisma.user.createMany({
        data: userIds.map((id) => ({
          id,
          email: `${id}@example.test`,
          fullName: id,
          passwordHash: 'integration-test-hash',
          isVerified: true,
        })),
      })
      await prisma.organization.createMany({
        data: [
          {
            id: organizationAId,
            name: 'Workspace Tenant A',
            slug: `workspace-tenant-a-${suffix}`,
            ownerUserId: ownerAId,
          },
          {
            id: organizationBId,
            name: 'Workspace Tenant B',
            slug: `workspace-tenant-b-${suffix}`,
            ownerUserId: ownerBId,
          },
        ],
      })
      await prisma.workspace.createMany({
        data: [
          {
            id: workspaceAId,
            organizationId: organizationAId,
            name: 'Tenant A',
            slug: 'tenant-a',
          },
          {
            id: workspaceBId,
            organizationId: organizationBId,
            name: 'Tenant B',
            slug: 'tenant-b',
          },
        ],
      })
      await prisma.workspaceMembership.createMany({
        data: [
          { workspaceId: workspaceAId, userId: ownerAId, role: 'OWNER' },
          { workspaceId: workspaceAId, userId: memberAId, role: 'DEVELOPER' },
          { workspaceId: workspaceAId, userId: viewerAId, role: 'VIEWER' },
          {
            workspaceId: workspaceAId,
            userId: suspendedAId,
            role: 'ADMIN',
            status: 'SUSPENDED',
          },
          { workspaceId: workspaceBId, userId: ownerBId, role: 'OWNER' },
        ],
      })
      const automationA = await prisma.automation.create({
        data: {
          workspaceId: workspaceAId,
          userId: ownerAId,
          goal: 'Tenant A workflow',
          title: 'Tenant A workflow',
          mode: AutomationMode.DRAFT_ONLY,
          status: AutomationStatus.DRAFT,
        },
      })
      const automationB = await prisma.automation.create({
        data: {
          workspaceId: workspaceBId,
          userId: ownerBId,
          goal: 'Tenant B workflow',
          title: 'Tenant B workflow',
          mode: AutomationMode.DRAFT_ONLY,
          status: AutomationStatus.DRAFT,
        },
      })
      const personalAutomation = await prisma.automation.create({
        data: {
          userId: memberAId,
          goal: 'Personal workflow',
          title: 'Personal workflow',
          mode: AutomationMode.DRAFT_ONLY,
          status: AutomationStatus.DRAFT,
        },
      })
      const socialA = await prisma.socialPost.create({
        data: {
          workspaceId: workspaceAId,
          userId: ownerAId,
          platform: SocialProvider.LINKEDIN,
          platformAccountId: 'unselected',
          destinationLabel: 'Tenant A',
          content: 'Workspace A post',
        },
      })
      const socialB = await prisma.socialPost.create({
        data: {
          workspaceId: workspaceBId,
          userId: ownerBId,
          platform: SocialProvider.LINKEDIN,
          platformAccountId: 'unselected',
          destinationLabel: 'Tenant B',
          content: 'Workspace B post',
          status: SocialPostStatus.SCHEDULED,
        },
      })
      const personalPost = await prisma.socialPost.create({
        data: {
          userId: memberAId,
          platform: SocialProvider.LINKEDIN,
          platformAccountId: 'unselected',
          destinationLabel: 'Personal',
          content: 'Personal post',
        },
      })
      await prisma.repository.create({
        data: {
          id: repositoryId,
          workspaceId: workspaceBId,
          userId: memberAId,
          name: 'tenant-b/private-repository',
          url: `https://example.test/tenant-b/${suffix}`,
        },
      })
      await prisma.codeReview.create({
        data: {
          id: foreignReviewId,
          workspaceId: workspaceBId,
          userId: memberAId,
          repositoryId,
          title: 'Tenant B review',
          fileContent: 'const tenant = "B";',
          status: 'completed',
        },
      })
      const credentialSentinel = `encrypted-credential-${suffix}`
      const encryptedCredential = encrypt(credentialSentinel)
      await prisma.workspaceIntegration.create({
        data: {
          workspaceId: workspaceAId,
          provider: WorkspaceIntegrationProvider.GITHUB,
          externalAccountId: `github-${suffix}`,
          displayName: 'Tenant A GitHub',
          encryptedCredential,
          scopes: ['repo'],
        },
      })
      await prisma.workspaceBillingAccount.create({
        data: { organizationId: organizationAId, plan: 'PRO', status: 'ACTIVE' },
      })

      const automationResponse = await fetch(`${baseUrl}/automations`, {
        headers: headersFor(memberAId, workspaceAId),
      })
      assert.equal(automationResponse.status, 200)
      const automations = (await automationResponse.json()) as Array<{ id: string }>
      assert.ok(automations.some(({ id }) => id === automationA.id))
      assert.ok(!automations.some(({ id }) => id === automationB.id))
      assert.ok(!automations.some(({ id }) => id === personalAutomation.id))
      const crossWorkspaceAutomation = await fetch(
        `${baseUrl}/automations/${automationB.id}`,
        { headers: headersFor(memberAId, workspaceAId) }
      )
      assert.equal(crossWorkspaceAutomation.status, 404)
      const personalAutomationResponse = await fetch(`${baseUrl}/automations`, {
        headers: headersFor(memberAId),
      })
      assert.equal(personalAutomationResponse.status, 200)
      const personalAutomations =
        (await personalAutomationResponse.json()) as Array<{ id: string }>
      assert.ok(personalAutomations.some(({ id }) => id === personalAutomation.id))
      assert.ok(!personalAutomations.some(({ id }) => id === automationA.id))

      const deniedWorkspace = await fetch(`${baseUrl}/automations`, {
        headers: headersFor(memberAId, workspaceBId),
      })
      assert.equal(deniedWorkspace.status, 404)
      const suspendedMember = await fetch(`${baseUrl}/automations`, {
        headers: headersFor(suspendedAId, workspaceAId),
      })
      assert.equal(suspendedMember.status, 404)
      const roleDenied = await fetch(`${baseUrl}/automations`, {
        method: 'POST',
        headers: { ...headersFor(viewerAId, workspaceAId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: 'Should be denied' }),
      })
      assert.equal(roleDenied.status, 403)
      const socialRoleDenied = await fetch(
        `${baseUrl}/social/posts/${socialA.id}/approve`,
        { method: 'POST', headers: headersFor(viewerAId, workspaceAId) }
      )
      assert.equal(socialRoleDenied.status, 403)

      const socialResponse = await fetch(`${baseUrl}/social/posts`, {
        headers: headersFor(memberAId, workspaceAId),
      })
      assert.equal(socialResponse.status, 200)
      const socialPosts = (await socialResponse.json()) as Array<{ id: string }>
      assert.ok(socialPosts.some(({ id }) => id === socialA.id))
      assert.ok(!socialPosts.some(({ id }) => id === socialB.id))
      const crossWorkspaceSocial = await fetch(`${baseUrl}/social/posts/${socialB.id}`, {
        method: 'PATCH',
        headers: {
          ...headersFor(memberAId, workspaceAId),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Cannot update tenant B',
          accountId: null,
          scheduledAt: null,
        }),
      })
      assert.equal(crossWorkspaceSocial.status, 404)
      const personalSocialResponse = await fetch(`${baseUrl}/social/posts`, {
        headers: headersFor(memberAId),
      })
      assert.equal(personalSocialResponse.status, 200)
      const personalSocialPosts = (await personalSocialResponse.json()) as Array<{ id: string }>
      assert.ok(personalSocialPosts.some(({ id }) => id === personalPost.id))
      await assert.rejects(
        () =>
          new SocialService(
            undefined,
            undefined,
            undefined,
            undefined,
            async () => 'This draft must not be generated.'
          ).generateDraft(memberAId, {
            instructions: 'Draft a post from this review.',
            reviewId: foreignReviewId,
          }),
        /Select one of your completed code reviews as evidence\./
      )

      const integrationResponse = await fetch(`${baseUrl}/integrations`, {
        headers: headersFor(memberAId, workspaceAId),
      })
      assert.equal(integrationResponse.status, 200)
      const integrationBody = await integrationResponse.text()
      assert.match(integrationBody, /Tenant A GitHub/)
      assert.doesNotMatch(integrationBody, new RegExp(credentialSentinel))
      assert.doesNotMatch(integrationBody, new RegExp(encryptedCredential))
      const otherIntegrationResponse = await fetch(`${baseUrl}/integrations`, {
        headers: headersFor(memberAId, workspaceBId),
      })
      assert.equal(otherIntegrationResponse.status, 404)

      const billingResponse = await fetch(`${baseUrl}/billing/subscription`, {
        headers: headersFor(ownerAId, workspaceAId),
      })
      assert.equal(billingResponse.status, 200)
      assert.equal((await billingResponse.json() as { plan: string }).plan, 'PRO')
      const viewerBilling = await fetch(`${baseUrl}/billing/subscription`, {
        headers: headersFor(viewerAId, workspaceAId),
      })
      assert.equal(viewerBilling.status, 403)
      const billingMutationDenied = await fetch(`${baseUrl}/billing/cancel-subscription`, {
        method: 'POST',
        headers: headersFor(viewerAId, workspaceAId),
      })
      assert.equal(billingMutationDenied.status, 403)

      assert.equal(await loadAutomationJob(automationA.id, workspaceAId) !== null, true)
      assert.equal(await loadAutomationJob(automationA.id, workspaceBId), null)
      assert.equal(await loadAutomationJob(personalAutomation.id, null) !== null, true)
      assert.equal(await loadAutomationJob(personalAutomation.id) !== null, true)
      await new SocialService().publishScheduledPost(socialB.id, 0, workspaceAId)
      assert.equal(
        (await prisma.socialPost.findUniqueOrThrow({ where: { id: socialB.id } })).status,
        SocialPostStatus.SCHEDULED
      )
      await new SocialService().publishScheduledPost(socialB.id, 0)
      assert.equal(
        (await prisma.socialPost.findUniqueOrThrow({ where: { id: socialB.id } })).status,
        SocialPostStatus.SCHEDULED
      )
      assert.equal(await findReviewForProcessing(foreignReviewId, workspaceAId), null)
      assert.equal(await findReviewForProcessing(foreignReviewId, workspaceBId), null)
      assert.equal(
        (await prisma.codeReview.findUnique({ where: { id: foreignReviewId } }))?.workspaceId,
        workspaceBId
      )
      assert.equal(
        (
          await prisma.repository.findMany({ where: { workspaceId: workspaceAId } })
        ).some((repository) => repository.id === repositoryId),
        false
      )
      assert.equal(
        await prisma.workspaceIntegration.count({ where: { workspaceId: workspaceBId } }),
        0
      )
      assert.equal(
        (
          await prisma.workspaceIntegration.findFirstOrThrow({
            where: { workspaceId: workspaceAId },
          })
        ).encryptedCredential,
        encryptedCredential
      )
      assert.equal(
        await prisma.workspaceBillingAccount.count({ where: { organizationId: organizationBId } }),
        0
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      await prisma.codeReview.deleteMany({ where: { id: foreignReviewId } })
      await prisma.repository.deleteMany({ where: { id: repositoryId } })
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspaceAId, workspaceBId] } },
      })
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
      await prisma.$disconnect()
    }
  }
)
