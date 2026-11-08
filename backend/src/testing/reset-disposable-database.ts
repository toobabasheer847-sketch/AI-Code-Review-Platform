import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DisposableDatabaseError,
  assertDisposableTestDatabase,
  canonicalDatabaseUrl,
} from './disposable-database'

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(backendRoot, 'package.json'))
const prismaCli = require.resolve('prisma/build/index.js')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  fail('DATABASE_URL is required and must be a localhost disposable test database.')
}

let target: ReturnType<typeof assertDisposableTestDatabase>
try {
  target = assertDisposableTestDatabase(databaseUrl)
  const integrationUrl = process.env.INTEGRATION_TEST_DATABASE_URL?.trim()
  if (integrationUrl && canonicalDatabaseUrl(integrationUrl) !== canonicalDatabaseUrl(databaseUrl)) {
    throw new DisposableDatabaseError(
      'INTEGRATION_TEST_DATABASE_URL must match DATABASE_URL before the disposable database can be reset'
    )
  }
} catch (error) {
  fail(error instanceof Error ? error.message : 'Refusing to reset this database')
}

console.warn(
  `Resetting disposable database "${target.databaseName}" on ${target.hostname}. This drops its data and reapplies committed migrations.`
)

const child = spawn(
  process.execPath,
  [
    prismaCli,
    'migrate',
    'reset',
    '--force',
    '--skip-seed',
    '--schema',
    'src/prisma/schema.prisma',
  ],
  {
    cwd: backendRoot,
    env: process.env,
    stdio: 'inherit',
  }
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
