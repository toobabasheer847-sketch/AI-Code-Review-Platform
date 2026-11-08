import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AIRequestStatus,
  AutomationMode,
  AutomationScheduleFrequency,
  AutomationStatus,
  Prisma,
  SocialProvider,
  WorkMemorySource,
  WorkMemoryType,
  type PrismaClient,
} from '@prisma/client'
import test, { after, before, describe } from 'node:test'
import { resolveDisposableTestDatabaseUrl } from './disposable-database'
import {
  expectedTenantIndexes,
  listMigrationNames,
  nullableWorkspaceTables,
} from './migration-safety'

const testDatabaseUrl = resolveDisposableTestDatabaseUrl()
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(backendRoot, 'package.json'))
const prismaCli = require.resolve('prisma/build/index.js')

describe('disposable database migrations', { concurrency: false, skip: !testDatabaseUrl }, () => {
  let prisma: PrismaClient

  before(async () => {
    prisma = (await import('@/config/database')).prisma
  })

  after(async () => {
    await prisma.$disconnect()
  })

  test('applies every committed migration and keeps the tenancy schema recoverable', async () => {
    const names = await listMigrationNames()
    const applied = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
    >`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`

    const successful = applied.filter(
      (migration) => migration.finished_at !== null && migration.rolled_back_at === null
    )
    assert.deepEqual(
      successful.map((migration) => migration.migration_name).sort(),
      names
    )
    assert.equal(
      applied.every((migration) => migration.finished_at !== null || migration.rolled_back_at !== null),
      true
    )

    const columns = await prisma.$queryRaw<Array<{ table_name: string; is_nullable: string }>>`
      SELECT table_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'workspaceId'
        AND table_name IN (${Prisma.join([...nullableWorkspaceTables])})
    `
    assert.deepEqual(
      columns.map((column) => `${column.table_name}:${column.is_nullable}`).sort(),
      nullableWorkspaceTables.map((table) => `${table}:YES`).sort()
    )

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (${Prisma.join([...expectedTenantIndexes])})
    `
    assert.deepEqual(
      indexes.map((index) => index.indexname).sort(),
      [...expectedTenantIndexes].sort()
    )

    const ownerDelete = await prisma.$queryRaw<Array<{ confdeltype: string }>>`
      SELECT confdeltype::text
      FROM pg_constraint
      WHERE conname = 'Organization_ownerUserId_fkey'
    `
    assert.equal(ownerDelete[0]?.confdeltype, 'r')
  })

  test('replays workspace backfill without moving another tenant', async () => {
    const userId = `backfill-${randomUUID()}`
    const personalWorkspaceId = `personal-workspace-${userId}`
    const preserved = await prisma.repository.findFirst({
      where: { userId: { not: userId } },
      select: { id: true, workspaceId: true },
    })

    try {
      await prisma.user.create({
        data: {
          id: userId,
          email: `${userId}@example.test`,
          fullName: 'Backfill User',
          passwordHash: 'integration-test-hash',
          isVerified: true,
        },
      })
      const repository = await prisma.repository.create({
        data: {
          userId,
          name: 'legacy-repository',
          url: `https://example.test/legacy/${userId}`,
        },
      })
      await prisma.codeReview.create({
        data: {
          userId,
          repositoryId: repository.id,
          title: 'Legacy review',
          fileContent: 'const legacy = true;',
        },
      })
      const automation = await prisma.automation.create({
        data: {
          userId,
          goal: 'Legacy goal',
          title: 'Legacy automation',
          mode: AutomationMode.DRAFT_ONLY,
          status: AutomationStatus.DRAFT,
        },
      })
      await prisma.automationSchedule.create({
        data: {
          userId,
          sourceAutomationId: automation.id,
          title: 'Legacy schedule',
          goal: 'Legacy goal',
          workflowDefinition: {},
          plan: {},
          frequency: AutomationScheduleFrequency.DAILY,
          timeZone: 'UTC',
          localTime: '09:00',
          nextRunAt: new Date(),
        },
      })
      await prisma.socialAccount.create({
        data: {
          userId,
          provider: SocialProvider.LINKEDIN,
          providerAccountId: `legacy-${userId}`,
          displayName: 'Legacy account',
          accessToken: 'fixture-token',
          scopes: [],
          tokenExpiresAt: new Date(Date.now() + 60_000),
        },
      })
      await prisma.socialPost.create({
        data: {
          userId,
          platform: SocialProvider.LINKEDIN,
          platformAccountId: 'unselected',
          destinationLabel: 'Legacy',
          content: 'Legacy post',
        },
      })
      await prisma.usage.create({
        data: { userId, month: 1, year: 2024 },
      })
      await prisma.aiRequestUsage.create({
        data: {
          userId,
          feature: 'review',
          provider: 'openai',
          modelName: 'test-model',
          durationMs: 1,
          status: AIRequestStatus.SUCCEEDED,
          idempotencyKey: `legacy-${userId}`,
        },
      })
      await prisma.workMemory.create({
        data: {
          userId,
          type: WorkMemoryType.PROJECT_SUMMARY,
          source: WorkMemorySource.USER_PROVIDED,
          sourceLabel: 'Legacy memory',
          content: 'Legacy context',
        },
      })

      await replayBackfill(prisma, userId)
      await replayBackfill(prisma, userId)
      await assertBackfill(prisma, userId, personalWorkspaceId)

      if (preserved) {
        const current = await prisma.repository.findUniqueOrThrow({
          where: { id: preserved.id },
          select: { workspaceId: true },
        })
        assert.equal(current.workspaceId, preserved.workspaceId)
      }
    } finally {
      await prisma.organization.deleteMany({ where: { ownerUserId: userId } })
      await prisma.user.deleteMany({ where: { id: userId } })
    }
  })

  test('rolls back a failed schema change and can reapply migrations', async () => {
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "phase14_recovery_probe"')
    await assert.rejects(
      prisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe('CREATE TABLE "phase14_recovery_probe" (id INT)')
        throw new Error('phase14 rollback')
      })
    )
    const probe = await prisma.$queryRaw<Array<{ name: string | null }>>`
      SELECT to_regclass('public.phase14_recovery_probe')::text AS name
    `
    assert.equal(probe[0]?.name, null)

    const deploy = spawnSync(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', 'src/prisma/schema.prisma'],
      { cwd: backendRoot, env: process.env, encoding: 'utf8' }
    )
    assert.equal(deploy.status, 0, deploy.stderr || deploy.stdout)
  })
})

async function replayBackfill(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "Organization" ("id", "name", "slug", "isPersonal", "ownerUserId")
    SELECT
      'personal-org-' || "id",
      "fullName" || '''s Organization',
      'personal-' || "id",
      true,
      "id"
    FROM "User"
    WHERE "id" = ${userId}
    ON CONFLICT ("id") DO NOTHING
  `
  await prisma.$executeRaw`
    INSERT INTO "Workspace" ("id", "organizationId", "name", "slug", "isPersonal")
    SELECT
      'personal-workspace-' || "id",
      'personal-org-' || "id",
      'Personal',
      'personal',
      true
    FROM "User"
    WHERE "id" = ${userId}
    ON CONFLICT ("id") DO NOTHING
  `
  await prisma.$executeRaw`
    INSERT INTO "WorkspaceMembership" ("id", "workspaceId", "userId", "role", "status")
    SELECT
      'personal-membership-' || "id",
      'personal-workspace-' || "id",
      "id",
      'OWNER',
      'ACTIVE'
    FROM "User"
    WHERE "id" = ${userId}
    ON CONFLICT ("workspaceId", "userId") DO NOTHING
  `
  for (const table of nullableWorkspaceTables) {
    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE ${Prisma.raw(`"${table}"`)}
        SET "workspaceId" = 'personal-workspace-' || "userId"
        WHERE "userId" = ${userId}
      `
    )
  }
}

async function assertBackfill(
  prisma: PrismaClient,
  userId: string,
  personalWorkspaceId: string
): Promise<void> {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: `personal-org-${userId}` },
  })
  assert.equal(organization.ownerUserId, userId)
  assert.equal(organization.isPersonal, true)
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: personalWorkspaceId },
  })
  assert.equal(workspace.organizationId, organization.id)
  assert.equal(workspace.isPersonal, true)
  const membership = await prisma.workspaceMembership.findUniqueOrThrow({
    where: { workspaceId_userId: { workspaceId: personalWorkspaceId, userId } },
  })
  assert.equal(membership.role, 'OWNER')
  assert.equal(membership.status, 'ACTIVE')
  assert.equal(
    await prisma.workspaceMembership.count({
      where: { workspaceId: personalWorkspaceId, userId },
    }),
    1
  )

  for (const table of nullableWorkspaceTables) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM ${Prisma.raw(`"${table}"`)}
        WHERE "userId" = ${userId}
          AND (
            "workspaceId" IS NULL
            OR "workspaceId" <> 'personal-workspace-' || "userId"
          )
      `
    )
    assert.equal(Number(rows[0]?.count ?? 0), 0, table)
  }
}
