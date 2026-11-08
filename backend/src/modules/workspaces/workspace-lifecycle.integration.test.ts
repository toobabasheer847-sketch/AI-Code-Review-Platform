import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import test, { after, describe } from 'node:test'
import { resolveDisposableTestDatabaseUrl } from '@/testing/disposable-database'

const testDatabaseUrl = resolveDisposableTestDatabaseUrl()

describe('workspace database lifecycle', { concurrency: false, skip: !testDatabaseUrl }, () => {
  test('rolls back workspace creation when membership persistence fails', async () => {
    const [{ prisma }, { WorkspaceService }] = await Promise.all([
      import('@/config/database'),
      import('@/modules/workspaces/workspace.service'),
    ])
    const userId = `rollback-${randomUUID()}`
    const functionName = `phase14_reject_${randomUUID().replace(/-/g, '')}`
    try {
      await prisma.user.create({
        data: {
          id: userId,
          email: `${userId}@example.test`,
          fullName: 'Rollback User',
          passwordHash: 'integration-test-hash',
          isVerified: true,
        },
      })
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "${functionName}"() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'phase14 membership rejected';
        END;
        $$;
      `)
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${functionName}"
        BEFORE INSERT ON "WorkspaceMembership"
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
      `)

      await assert.rejects(
        () => new WorkspaceService().create(userId, { name: 'Rollback Workspace' }),
        /phase14 membership rejected/
      )
      assert.equal(await prisma.organization.count({ where: { ownerUserId: userId } }), 0)
      assert.equal(
        await prisma.workspaceBillingAccount.count({
          where: { organization: { is: { ownerUserId: userId } } },
        }),
        0
      )
      assert.equal(await prisma.workspaceMembership.count({ where: { userId } }), 0)
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${functionName}" ON "WorkspaceMembership";`
      )
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`)
      await prisma.organization.deleteMany({ where: { ownerUserId: userId } })
      await prisma.user.deleteMany({ where: { id: userId } })
    }
  })

  test('persists membership lifecycle, ownership, and tenant boundaries', async () => {
    const [{ prisma }, { WorkspaceService, WorkspaceServiceError }, { findReviewForProcessing }] =
      await Promise.all([
        import('@/config/database'),
        import('@/modules/workspaces/workspace.service'),
        import('@/jobs/review.worker-store'),
      ])
    const service = new WorkspaceService()
    const suffix = randomUUID()
    const owner = await createUser(prisma, `owner-${suffix}`)
    const ownerB = await createUser(prisma, `owner-b-${suffix}`)
    const developer = await createUser(prisma, `developer-${suffix}`)
    const successor = await createUser(prisma, `successor-${suffix}`)
    const adminA = await createUser(prisma, `admin-a-${suffix}`)
    const adminB = await createUser(prisma, `admin-b-${suffix}`)
    const unverified = await createUser(prisma, `unverified-${suffix}`, { isVerified: false })
    const mismatch = await createUser(prisma, `mismatch-${suffix}`)
    const userIds = [owner, ownerB, developer, successor, adminA, adminB, unverified, mismatch].map(
      (user) => user.id
    )
    const expectError =
      (statusCode: number) =>
      (error: unknown): true => {
        assert.ok(error instanceof WorkspaceServiceError)
        assert.equal(error.statusCode, statusCode)
        return true
      }

    try {
      const alpha = await service.create(owner.id, { name: 'Alpha Team', organizationName: 'Alpha' })
      assert.equal(alpha.role, 'OWNER')
      assert.equal(
        (await prisma.organization.findUniqueOrThrow({ where: { id: alpha.organization.id } }))
          .ownerUserId,
        owner.id
      )
      const ownerMembership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: alpha.id, userId: owner.id } },
      })
      assert.equal(ownerMembership.role, 'OWNER')
      assert.equal(ownerMembership.status, 'ACTIVE')
      assert.equal(
        (await prisma.workspaceBillingAccount.findUniqueOrThrow({
          where: { organizationId: alpha.organization.id },
        })).plan,
        'FREE'
      )

      const alphaApi = await service.createInOrganization(alpha.organization.id, owner.id, {
        name: 'Alpha API',
      })
      await assert.rejects(
        () => service.createInOrganization(alpha.organization.id, owner.id, { name: 'Alpha Team' }),
        expectError(409)
      )
      assert.equal(
        await prisma.workspace.count({ where: { organizationId: alpha.organization.id } }),
        2
      )

      const beta = await service.create(ownerB.id, { name: 'Beta Team' })
      assert.equal(
        await prisma.workspaceBillingAccount.count({
          where: { organizationId: beta.organization.id, plan: 'FREE' },
        }),
        1
      )
      assert.notEqual(
        (await prisma.workspaceBillingAccount.findUnique({
          where: { organizationId: beta.organization.id },
        }))?.id,
        (await prisma.workspaceBillingAccount.findUnique({
          where: { organizationId: alpha.organization.id },
        }))?.id
      )

      const developerInvitation = await service.createInvitation(
        alpha.id,
        owner.id,
        developer.email,
        'DEVELOPER'
      )
      const accepted = await service.acceptInvitation(developer.id, developerInvitation.token)
      assert.deepEqual(accepted, { workspaceId: alpha.id, role: 'DEVELOPER' })
      const developerMembership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: alpha.id, userId: developer.id } },
      })
      await assert.rejects(
        () => service.acceptInvitation(developer.id, developerInvitation.token),
        expectError(404)
      )

      const repository = await prisma.repository.create({
        data: {
          workspaceId: alpha.id,
          userId: developer.id,
          name: 'alpha/private',
          url: `https://example.test/alpha/${suffix}`,
        },
      })
      const review = await prisma.codeReview.create({
        data: {
          workspaceId: alpha.id,
          userId: developer.id,
          repositoryId: repository.id,
          title: 'Alpha review',
          fileContent: 'const alpha = true;',
        },
      })
      assert.equal((await findReviewForProcessing(review.id, alpha.id))?.id, review.id)
      assert.equal(await findReviewForProcessing(review.id, beta.id), null)
      assert.equal(
        (await prisma.repository.findMany({ where: { workspaceId: beta.id } })).some(
          (item) => item.id === repository.id
        ),
        false
      )
      assert.equal(
        (await service.listMembers(beta.id)).some((member) => member.userId === developer.id),
        false
      )

      await assert.rejects(
        () =>
          service.updateMember(beta.id, ownerB.id, 'OWNER', developerMembership.id, {
            status: 'SUSPENDED',
          }),
        expectError(404)
      )
      assert.equal(
        (await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: developerMembership.id } }))
          .status,
        'ACTIVE'
      )

      await assert.rejects(
        () =>
          service.updateMember(alpha.id, developer.id, 'DEVELOPER', developerMembership.id, {
            status: 'SUSPENDED',
          }),
        expectError(400)
      )
      assert.equal(
        (await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: developerMembership.id } }))
          .status,
        'ACTIVE'
      )
      const suspended = await service.updateMember(
        alpha.id,
        owner.id,
        'OWNER',
        developerMembership.id,
        { status: 'SUSPENDED' }
      )
      assert.equal(suspended.status, 'SUSPENDED')
      assert.equal(await findReviewForProcessing(review.id, alpha.id), null)
      await assert.rejects(
        () =>
          service.updateMember(alpha.id, owner.id, 'OWNER', ownerMembership.id, {
            status: 'SUSPENDED',
          }),
        expectError(409)
      )
      await service.removeMember(alpha.id, owner.id, 'OWNER', developerMembership.id)
      assert.equal(
        (await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: developerMembership.id } }))
          .status,
        'REMOVED'
      )
      await assert.rejects(
        () => service.removeMember(alpha.id, owner.id, 'OWNER', ownerMembership.id),
        expectError(409)
      )

      const renewed = await service.acceptInvitation(
        developer.id,
        (await service.createInvitation(alpha.id, owner.id, developer.email, 'DEVELOPER')).token
      )
      assert.equal(renewed.role, 'DEVELOPER')
      assert.equal(
        (await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: developerMembership.id } }))
          .status,
        'ACTIVE'
      )

      const expired = await service.createInvitation(
        alpha.id,
        owner.id,
        `expired-${suffix}@example.test`,
        'VIEWER'
      )
      await prisma.workspaceInvitation.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      })
      const expiredUser = await createUser(prisma, `expired-${suffix}`)
      userIds.push(expiredUser.id)
      await assert.rejects(
        () => service.acceptInvitation(expiredUser.id, expired.token),
        expectError(410)
      )
      assert.equal(
        (await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: expired.id } })).status,
        'EXPIRED'
      )
      assert.equal(
        await prisma.workspaceMembership.count({ where: { userId: expiredUser.id } }),
        0
      )
      await assert.rejects(
        () => service.acceptInvitation(expiredUser.id, expired.token),
        expectError(404)
      )

      const mismatched = await service.createInvitation(
        alpha.id,
        owner.id,
        `invitee-${suffix}@example.test`,
        'VIEWER'
      )
      await assert.rejects(
        () => service.acceptInvitation(mismatch.id, mismatched.token),
        expectError(403)
      )
      assert.equal(
        (await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: mismatched.id } })).status,
        'PENDING'
      )
      await assert.rejects(
        () => service.acceptInvitation(unverified.id, mismatched.token),
        expectError(403)
      )
      await assert.rejects(
        () => service.createInvitation(alpha.id, owner.id, mismatched.email, 'VIEWER'),
        expectError(409)
      )
      await assert.rejects(
        () => service.createInvitation(alpha.id, owner.id, `owner-role-${suffix}@example.test`, 'OWNER'),
        expectError(400)
      )

      const personalWorkspaceId = `personal-${suffix}`
      await prisma.organization.create({
        data: {
          name: 'Personal',
          slug: `personal-${suffix}`,
          isPersonal: true,
          ownerUserId: owner.id,
          workspaces: {
            create: {
              id: personalWorkspaceId,
              name: 'Personal',
              slug: 'personal',
              isPersonal: true,
              memberships: { create: { userId: owner.id, role: 'OWNER', status: 'ACTIVE' } },
            },
          },
        },
      })
      await assert.rejects(
        () =>
          service.createInvitation(
            personalWorkspaceId,
            owner.id,
            `personal-invite-${suffix}@example.test`,
            'VIEWER'
          ),
        expectError(409)
      )
      await assert.rejects(
        () => service.transferOwnership(personalWorkspaceId, owner.id, successor.id),
        expectError(409)
      )

      const revoked = await service.createInvitation(
        alpha.id,
        owner.id,
        `revoked-${suffix}@example.test`,
        'VIEWER'
      )
      await assert.rejects(() => service.revokeInvitation(beta.id, revoked.id), expectError(404))
      assert.equal(
        (await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: revoked.id } })).status,
        'PENDING'
      )
      await service.revokeInvitation(alpha.id, revoked.id)
      const revokedUser = await createUser(prisma, `revoked-${suffix}`)
      userIds.push(revokedUser.id)
      await assert.rejects(
        () => service.acceptInvitation(revokedUser.id, revoked.token),
        expectError(404)
      )

      await service.acceptInvitation(
        adminA.id,
        (await service.createInvitation(alpha.id, owner.id, adminA.email, 'ADMIN')).token
      )
      const adminBMembership = await membershipAfterAccept(
        prisma,
        service,
        alpha.id,
        owner.id,
        adminB
      )
      await assert.rejects(
        () =>
          service.updateMember(alpha.id, adminA.id, 'ADMIN', adminBMembership.id, {
            status: 'SUSPENDED',
          }),
        expectError(403)
      )
      assert.equal(
        (await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: adminBMembership.id } }))
          .status,
        'ACTIVE'
      )

      await assert.rejects(
        () => service.transferOwnership(alpha.id, owner.id, successor.id),
        expectError(409)
      )
      assert.equal(
        (await prisma.organization.findUniqueOrThrow({ where: { id: alpha.organization.id } }))
          .ownerUserId,
        owner.id
      )
      assert.equal(
        (await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: ownerMembership.id } }))
          .role,
        'OWNER'
      )
      await service.acceptInvitation(
        successor.id,
        (await service.createInvitation(alpha.id, owner.id, successor.email, 'ADMIN')).token
      )
      await service.acceptInvitation(
        successor.id,
        (await service.createInvitation(alphaApi.id, owner.id, successor.email, 'ADMIN')).token
      )
      await service.transferOwnership(alpha.id, owner.id, successor.id)
      assert.equal(
        (await prisma.organization.findUniqueOrThrow({ where: { id: alpha.organization.id } }))
          .ownerUserId,
        successor.id
      )
      for (const workspaceId of [alpha.id, alphaApi.id]) {
        assert.equal(
          (
            await prisma.workspaceMembership.findUniqueOrThrow({
              where: { workspaceId_userId: { workspaceId, userId: owner.id } },
            })
          ).role,
          'ADMIN'
        )
        assert.equal(
          (
            await prisma.workspaceMembership.findUniqueOrThrow({
              where: { workspaceId_userId: { workspaceId, userId: successor.id } },
            })
          ).role,
          'OWNER'
        )
      }
      assert.equal(
        (await prisma.workspaceMembership.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId: beta.id, userId: ownerB.id } },
        })).role,
        'OWNER'
      )

      const replayInvitation = await service.createInvitation(
        beta.id,
        ownerB.id,
        developer.email,
        'VIEWER'
      )
      const replayResults = await Promise.allSettled([
        service.acceptInvitation(developer.id, replayInvitation.token),
        service.acceptInvitation(developer.id, replayInvitation.token),
      ])
      assert.equal(replayResults.filter((result) => result.status === 'fulfilled').length, 1)
      assert.equal(replayResults.filter((result) => result.status === 'rejected').length, 1)
      assert.equal(
        await prisma.workspaceMembership.count({
          where: { workspaceId: beta.id, userId: developer.id, status: 'ACTIVE' },
        }),
        1
      )
      assert.equal(
        (await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: replayInvitation.id } }))
          .status,
        'ACCEPTED'
      )

      const concurrent = await membershipAfterAccept(
        prisma,
        service,
        beta.id,
        ownerB.id,
        await createUser(prisma, `concurrent-${suffix}`).then((user) => {
          userIds.push(user.id)
          return user
        })
      )
      await Promise.all([
        service.updateMember(beta.id, ownerB.id, 'OWNER', concurrent.id, { role: 'VIEWER' }),
        service.updateMember(beta.id, ownerB.id, 'OWNER', concurrent.id, { status: 'SUSPENDED' }),
      ])
      const concurrentRow = await prisma.workspaceMembership.findUniqueOrThrow({
        where: { id: concurrent.id },
      })
      assert.equal(concurrentRow.role, 'VIEWER')
      assert.equal(concurrentRow.status, 'SUSPENDED')
      assert.equal(
        await prisma.workspaceMembership.count({
          where: { workspaceId: beta.id, userId: concurrent.userId },
        }),
        1
      )
    } finally {
      await prisma.organization.deleteMany({ where: { ownerUserId: { in: userIds } } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    }
  })

  test('emails one acceptance link and revokes the invitation when delivery fails', async () => {
    const [{ prisma }, { WorkspaceService, WorkspaceServiceError }] = await Promise.all([
      import('@/config/database'),
      import('@/modules/workspaces/workspace.service'),
    ])
    const suffix = randomUUID()
    const owner = await createUser(prisma, `mail-owner-${suffix}`)
    const invitee = await createUser(prisma, `mail-invitee-${suffix}`)
    const other = await createUser(prisma, `mail-other-${suffix}`)
    const userIds = [owner.id, invitee.id, other.id]
    const mailed: string[] = []
    let attempts = 0
    const service = new WorkspaceService({
      async send(message) {
        attempts += 1
        if (attempts === 1) throw new Error('temporary mailbox timeout')
        mailed.push(message.acceptUrl)
        assert.equal(message.to, invitee.email)
        assert.equal(message.workspaceName, 'Mail Team')
        assert.equal(message.roleLabel, 'Developer')
      },
    })

    try {
      const workspace = await service.create(owner.id, {
        name: 'Mail Team',
        organizationName: `Mail ${suffix}`,
      })
      const created = await service.createAndSendInvitation(
        workspace.id,
        owner.id,
        invitee.email,
        'DEVELOPER'
      )
      const token = new URL(mailed[0] ?? 'http://invalid').searchParams.get('token') ?? ''
      assert.equal(created.delivery, 'sent')
      assert.equal(Object.hasOwn(created, 'token'), false)
      assert.equal(JSON.stringify(created).includes(token), false)
      assert.equal(attempts, 2)
      assert.equal(mailed.length, 1)
      const stored = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: created.id } })
      assert.equal(stored.status, 'PENDING')
      assert.notEqual(stored.tokenHash, token)
      assert.equal(stored.tokenHash.length, 64)

      await service.acceptInvitation(invitee.id, token)
      assert.equal(
        (await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: created.id } })).status,
        'ACCEPTED'
      )
      const membership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: invitee.id } },
      })
      assert.equal(membership.role, 'DEVELOPER')
      assert.equal(membership.status, 'ACTIVE')

      const failing = new WorkspaceService({
        async send(message) {
          throw new Error(`provider rejected ${message.acceptUrl}`)
        },
      })
      await assert.rejects(
        () => failing.createAndSendInvitation(workspace.id, owner.id, other.email, 'VIEWER'),
        (error: unknown) => {
          assert.ok(error instanceof WorkspaceServiceError)
          assert.equal(error.statusCode, 503)
          assert.equal(error.message, 'The invitation email could not be sent. No invitation was left pending.')
          assert.equal(/token|accept-invitation|provider/i.test(error.message), false)
          return true
        }
      )
      const revoked = await prisma.workspaceInvitation.findFirstOrThrow({
        where: { workspaceId: workspace.id, email: other.email },
      })
      assert.equal(revoked.status, 'REVOKED')
      assert.equal(
        await prisma.workspaceInvitation.count({
          where: { workspaceId: workspace.id, email: other.email, status: 'PENDING' },
        }),
        0
      )
    } finally {
      await prisma.organization.deleteMany({ where: { ownerUserId: { in: userIds } } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    }
  })

  test('resends a pending invitation with a new token and rejects the old one', async () => {
    const [{ prisma }, { WorkspaceService, WorkspaceServiceError }] = await Promise.all([
      import('@/config/database'),
      import('@/modules/workspaces/workspace.service'),
    ])
    const suffix = randomUUID()
    const owner = await createUser(prisma, `resend-owner-${suffix}`)
    const invitee = await createUser(prisma, `resend-invitee-${suffix}`)
    const userIds = [owner.id, invitee.id]
    const mailed: string[] = []
    const service = new WorkspaceService({
      async send(message) {
        mailed.push(message.acceptUrl)
        assert.equal(message.to, invitee.email)
      },
    })
    const expectError =
      (statusCode: number, message: string) =>
      (error: unknown): true => {
        assert.ok(error instanceof WorkspaceServiceError)
        assert.equal(error.statusCode, statusCode)
        assert.equal(error.message, message)
        assert.equal(/token|accept-invitation/i.test(error.message), false)
        return true
      }

    try {
      const workspace = await service.create(owner.id, {
        name: 'Resend Team',
        organizationName: `Resend ${suffix}`,
      })
      const other = await service.create(owner.id, { name: `Resend Other ${suffix}` })
      const original = await service.createInvitation(workspace.id, owner.id, invitee.email, 'DEVELOPER')
      const resent = await service.resendInvitation(workspace.id, original.id, owner.id)
      const replacementToken = new URL(mailed.at(-1) ?? 'http://invalid').searchParams.get('token') ?? ''
      assert.equal(resent.delivery, 'sent')
      assert.equal(resent.id === original.id, false)
      assert.equal(Object.hasOwn(resent, 'token'), false)
      assert.equal(JSON.stringify(resent).includes(replacementToken), false)
      assert.equal(mailed.length, 1)
      assert.equal(
        (await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: original.id } })).status,
        'REVOKED'
      )
      await assert.rejects(
        () => service.acceptInvitation(invitee.id, original.token),
        expectError(404, 'Invitation is invalid or has already been used')
      )
      await service.acceptInvitation(invitee.id, replacementToken)
      assert.equal(
        (
          await prisma.workspaceMembership.findUniqueOrThrow({
            where: { workspaceId_userId: { workspaceId: workspace.id, userId: invitee.id } },
          })
        ).role,
        'DEVELOPER'
      )

      const pending = await service.createInvitation(workspace.id, owner.id, `fresh-${suffix}@example.test`, 'VIEWER')
      const callsBeforeDenial = mailed.length
      await assert.rejects(
        () => service.resendInvitation(other.id, pending.id, owner.id),
        expectError(404, 'Invitation not found')
      )
      assert.equal(
        (await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: pending.id } })).status,
        'PENDING'
      )
      await prisma.workspaceInvitation.update({
        where: { id: pending.id },
        data: { expiresAt: new Date('2020-01-01T00:00:00.000Z') },
      })
      await assert.rejects(
        () => service.resendInvitation(workspace.id, pending.id, owner.id),
        expectError(410, 'This invitation has expired. Send a new invitation.')
      )
      assert.equal(
        (await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: pending.id } })).status,
        'EXPIRED'
      )
      await assert.rejects(
        () => service.resendInvitation(workspace.id, original.id, owner.id),
        expectError(409, 'This invitation has been revoked')
      )
      const accepted = await prisma.workspaceInvitation.findFirstOrThrow({
        where: { workspaceId: workspace.id, email: invitee.email, status: 'ACCEPTED' },
      })
      await assert.rejects(
        () => service.resendInvitation(workspace.id, accepted.id, owner.id),
        expectError(409, 'This invitation has already been accepted')
      )
      assert.equal(mailed.length, callsBeforeDenial)
    } finally {
      await prisma.organization.deleteMany({ where: { ownerUserId: owner.id } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    }
  })

  test('revokes the replacement invitation when a resend email fails', async () => {
    const [{ prisma }, { WorkspaceService, WorkspaceServiceError }] = await Promise.all([
      import('@/config/database'),
      import('@/modules/workspaces/workspace.service'),
    ])
    const suffix = randomUUID()
    const owner = await createUser(prisma, `resend-fail-owner-${suffix}`)
    const userIds = [owner.id]
    const failing = new WorkspaceService({
      async send(message) {
        throw new Error(`smtp rejected ${message.acceptUrl}`)
      },
    })

    try {
      const workspace = await failing.create(owner.id, {
        name: 'Resend Failure',
        organizationName: `Resend Fail ${suffix}`,
      })
      const original = await failing.createInvitation(
        workspace.id,
        owner.id,
        `mailbox-${suffix}@example.test`,
        'VIEWER'
      )
      await assert.rejects(
        () => failing.resendInvitation(workspace.id, original.id, owner.id),
        (error: unknown) => {
          assert.ok(error instanceof WorkspaceServiceError)
          assert.equal(error.statusCode, 503)
          assert.equal(error.message, 'The invitation email could not be sent. No invitation was left pending.')
          assert.equal(/token|smtp|accept-invitation/i.test(error.message), false)
          return true
        }
      )
      assert.equal(
        (await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: original.id } })).status,
        'REVOKED'
      )
      assert.equal(
        await prisma.workspaceInvitation.count({
          where: { workspaceId: workspace.id, email: `mailbox-${suffix}@example.test`, status: 'PENDING' },
        }),
        0
      )
    } finally {
      await prisma.organization.deleteMany({ where: { ownerUserId: owner.id } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    }
  })

  after(async () => {
    const { prisma } = await import('@/config/database')
    await prisma.$disconnect()
  })
})

async function createUser(
  prisma: PrismaClient,
  id: string,
  options?: { isVerified?: boolean }
): Promise<{ id: string; email: string }> {
  const email = `${id}@example.test`
  await prisma.user.create({
    data: {
      id,
      email,
      fullName: id,
      passwordHash: 'integration-test-hash',
      isVerified: options?.isVerified ?? true,
    },
  })
  return { id, email }
}

async function membershipAfterAccept(
  prisma: PrismaClient,
  service: {
    createInvitation: (
      workspaceId: string,
      invitedById: string,
      email: string,
      role: 'ADMIN' | 'DEVELOPER' | 'VIEWER'
    ) => Promise<{ token: string }>
    acceptInvitation: (userId: string, token: string) => Promise<unknown>
  },
  workspaceId: string,
  ownerId: string,
  user: { id: string; email: string }
) {
  await service.acceptInvitation(
    user.id,
    (await service.createInvitation(workspaceId, ownerId, user.email, 'ADMIN')).token
  )
  return prisma.workspaceMembership.findUniqueOrThrow({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
  })
}
