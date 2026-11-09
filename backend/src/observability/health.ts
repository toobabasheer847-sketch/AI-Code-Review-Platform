export type DependencyState = 'ok' | 'unavailable'

export interface DependencyHealth {
  database: DependencyState
  redis: DependencyState
}

async function probe(check: () => Promise<unknown>): Promise<DependencyState> {
  try {
    await check()
    return 'ok'
  } catch {
    return 'unavailable'
  }
}

export async function checkDependencyHealth(checks: {
  database: () => Promise<unknown>
  redis: () => Promise<unknown>
}): Promise<DependencyHealth> {
  const [database, redis] = await Promise.all([
    probe(checks.database),
    probe(checks.redis),
  ])
  return { database, redis }
}
