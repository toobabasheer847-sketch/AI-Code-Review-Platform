import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const testingDirectory = dirname(fileURLToPath(import.meta.url))

export const migrationsDirectory = join(testingDirectory, '../prisma/migrations')

export const tenancyMigrationName = '20261106000000_workspace_tenancy'

export const nullableWorkspaceTables = [
  'Repository',
  'CodeReview',
  'Automation',
  'AutomationSchedule',
  'SocialAccount',
  'SocialPost',
  'Usage',
  'AIRequestUsage',
  'WorkMemory',
] as const

export const expectedTenantIndexes = [
  'Organization_slug_key',
  'Workspace_organizationId_slug_key',
  'WorkspaceMembership_workspaceId_userId_key',
  'WorkspaceInvitation_tokenHash_key',
  'WorkspaceInvitation_one_pending_email_key',
  'WorkspaceIntegration_workspaceId_provider_externalAccountId_key',
  'WorkspaceBillingAccount_organizationId_key',
  'WorkspaceUsage_organizationId_month_year_key',
] as const

const destructiveStatementPattern =
  /\b(drop\s+(table|column|schema|database|type)|truncate\b|delete\s+from)\b/i

export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ')
}

export function findDestructiveSql(sql: string): string[] {
  return stripSqlComments(sql)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && destructiveStatementPattern.test(line))
}

export async function listMigrationNames(): Promise<string[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

export async function readMigrationSql(migrationName: string): Promise<string> {
  return readFile(join(migrationsDirectory, migrationName, 'migration.sql'), 'utf8')
}

export interface MigrationSafetyIssue {
  migrationName: string
  detail: string
}

export async function findMigrationSafetyIssues(): Promise<MigrationSafetyIssue[]> {
  const issues: MigrationSafetyIssue[] = []
  const names = await listMigrationNames()
  for (const migrationName of names) {
    const directoryEntries = await readdir(join(migrationsDirectory, migrationName))
    if (directoryEntries.some((entry) => /(^|_)down\.sql$/i.test(entry))) {
      issues.push({
        migrationName,
        detail: 'Down migrations are not part of the reviewed recovery procedure',
      })
    }
    const sql = await readMigrationSql(migrationName)
    if (/prisma-migrate-disable-transactions|CREATE\s+INDEX\s+CONCURRENTLY/i.test(sql)) {
      issues.push({
        migrationName,
        detail: 'Migration disables the transaction that PostgreSQL uses to roll back a failed deploy',
      })
    }
    for (const statement of findDestructiveSql(sql)) {
      issues.push({ migrationName, detail: statement })
    }
    for (const detail of findPrematureConflictTargets(sql)) {
      issues.push({ migrationName, detail })
    }
  }
  return issues
}

function quotedColumns(value: string): string[] {
  return [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? '')
}

export function findPrematureConflictTargets(sql: string): string[] {
  const stripped = stripSqlComments(sql)
  const events: Array<{
    index: number
    kind: 'table' | 'unique' | 'conflict'
    table: string
    columns: string
  }> = []
  for (const match of stripped.matchAll(
    /CREATE TABLE "([^"]+)"[\s\S]*?PRIMARY KEY \(([^)]+)\)/g
  )) {
    events.push({
      index: match.index ?? 0,
      kind: 'table',
      table: match[1] ?? '',
      columns: quotedColumns(match[2] ?? '').join(','),
    })
  }
  for (const match of stripped.matchAll(
    /CREATE UNIQUE INDEX "[^"]+" ON "([^"]+)"\s*\(([^)]+)\)/g
  )) {
    events.push({
      index: match.index ?? 0,
      kind: 'unique',
      table: match[1] ?? '',
      columns: quotedColumns(match[2] ?? '').join(','),
    })
  }
  for (const match of stripped.matchAll(
    /INSERT INTO "([^"]+)"[\s\S]*?ON CONFLICT \(([^)]+)\)/g
  )) {
    events.push({
      index: match.index ?? 0,
      kind: 'conflict',
      table: match[1] ?? '',
      columns: quotedColumns(match[2] ?? '').join(','),
    })
  }

  const createdTables = new Set<string>()
  const uniqueKeys = new Map<string, Set<string>>()
  const issues: string[] = []
  for (const event of events.sort((left, right) => left.index - right.index)) {
    if (event.kind === 'table') {
      createdTables.add(event.table)
      const keys = uniqueKeys.get(event.table) ?? new Set<string>()
      keys.add(event.columns)
      uniqueKeys.set(event.table, keys)
      continue
    }
    if (event.kind === 'unique') {
      const keys = uniqueKeys.get(event.table) ?? new Set<string>()
      keys.add(event.columns)
      uniqueKeys.set(event.table, keys)
      continue
    }
    if (
      createdTables.has(event.table) &&
      !uniqueKeys.get(event.table)?.has(event.columns)
    ) {
      issues.push(
        `ON CONFLICT (${event.columns}) on "${event.table}" runs before its unique index or primary key`
      )
    }
  }
  return issues
}
