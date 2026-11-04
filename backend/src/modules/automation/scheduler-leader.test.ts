import assert from 'node:assert/strict'
import test from 'node:test'

import {
  runWithSchedulerLease,
  type SchedulerLeaseClient,
} from './scheduler-leader'

class InMemoryLeaseClient implements SchedulerLeaseClient {
  private token: string | null = null

  async set(_key: string, value: string): Promise<string | null> {
    if (this.token) return null
    this.token = value
    return 'OK'
  }

  async eval(script: string, options: { arguments: string[] }): Promise<number> {
    if (this.token !== options.arguments[0]) return 0
    if (script.includes('DEL')) this.token = null
    return 1
  }
}

test('only one replica runs a scheduler tick at a time', async () => {
  const client = new InMemoryLeaseClient()
  let releaseTick = (): void => undefined
  let markStarted = (): void => undefined
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const blockedTick = new Promise<void>((resolve) => {
    releaseTick = resolve
  })

  const firstReplica = runWithSchedulerLease(
    client,
    async () => {
      markStarted()
      await blockedTick
    },
    () => assert.fail('Unexpected lease error')
  )
  await started

  const secondReplicaRan = await runWithSchedulerLease(
    client,
    async () => assert.fail('A second replica must not run while the lease is held'),
    () => assert.fail('Unexpected lease error')
  )
  assert.equal(secondReplicaRan, false)

  releaseTick()
  assert.equal(await firstReplica, true)
})

test('releases the scheduler lease after work completes', async () => {
  const client = new InMemoryLeaseClient()

  assert.equal(await runWithSchedulerLease(client, async () => undefined, () => undefined), true)
  assert.equal(await runWithSchedulerLease(client, async () => undefined, () => undefined), true)
})
