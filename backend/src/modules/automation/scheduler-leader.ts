import { randomUUID } from 'node:crypto'

const LEASE_KEY = 'ai-codeguard:automation-scheduler:leader'
const LEASE_TTL_MS = 60_000
const HEARTBEAT_INTERVAL_MS = 20_000

const EXTEND_LEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  end
  return 0
`

const RELEASE_LEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`

export interface SchedulerLeaseClient {
  set(
    key: string,
    value: string,
    options: { NX: true; PX: number }
  ): Promise<string | null>
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>
}

export async function runWithSchedulerLease(
  client: SchedulerLeaseClient,
  run: () => Promise<void>,
  onLeaseError: (error: unknown) => void
): Promise<boolean> {
  const token = randomUUID()
  const acquired = await client.set(LEASE_KEY, token, { NX: true, PX: LEASE_TTL_MS })
  if (acquired !== 'OK') return false

  let heartbeatPending = false
  const heartbeat = setInterval(() => {
    if (heartbeatPending) return
    heartbeatPending = true
    void client
      .eval(EXTEND_LEASE_SCRIPT, {
        keys: [LEASE_KEY],
        arguments: [token, String(LEASE_TTL_MS)],
      })
      .then((result) => {
        if (Number(result) !== 1) {
          onLeaseError(new Error('Scheduler leadership lease was lost'))
        }
      })
      .catch(onLeaseError)
      .finally(() => {
        heartbeatPending = false
      })
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()

  try {
    await run()
    return true
  } finally {
    clearInterval(heartbeat)
    try {
      await client.eval(RELEASE_LEASE_SCRIPT, {
        keys: [LEASE_KEY],
        arguments: [token],
      })
    } catch (error) {
      onLeaseError(error)
    }
  }
}
