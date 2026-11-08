import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findDestructiveSql,
  findMigrationSafetyIssues,
  findPrematureConflictTargets,
  readMigrationSql,
  tenancyMigrationName,
} from './migration-safety'

test('requires a new table conflict target to exist before the insert', () => {
  const sql = `
    CREATE TABLE "WorkspaceMembership" (
      "workspaceId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
    );
    INSERT INTO "WorkspaceMembership" ("workspaceId", "userId")
    SELECT "id", "id" FROM "User"
    ON CONFLICT ("workspaceId", "userId") DO NOTHING;
  `
  assert.deepEqual(findPrematureConflictTargets(sql), [
    'ON CONFLICT (workspaceId,userId) on "WorkspaceMembership" runs before its unique index or primary key',
  ])
})

test('flags data-destroying SQL and ignores comments and referential actions', () => {
  assert.deepEqual(findDestructiveSql('DELETE FROM "User";'), ['DELETE FROM "User";'])
  assert.deepEqual(findDestructiveSql('ALTER TABLE "User" DROP COLUMN "email";'), [
    'ALTER TABLE "User" DROP COLUMN "email";',
  ])
  assert.deepEqual(findDestructiveSql('-- DELETE FROM "User";\nON DELETE CASCADE'), [])
})

test('committed migrations stay additive, transactional, and free of down scripts', async () => {
  const issues = await findMigrationSafetyIssues()
  assert.deepEqual(issues, [])
  const tenancySql = await readMigrationSql(tenancyMigrationName)
  assert.match(tenancySql, /Rollback strategy/)
  assert.match(tenancySql, /Do not clear tenant associations/)
  assert.match(
    tenancySql,
    /Workspace backfill left tenant-owned records unassigned or assigned to the wrong user/
  )
})
