import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FindingVerificationLimitError,
  FindingVerificationNotFoundError,
  MAX_FINDING_VERIFICATION_REQUESTS,
  FindingVerificationService,
  requestFindingVerificationSchema,
  type FindingVerificationRecord,
  type FindingVerificationStore,
} from './finding-verification.service'

const sourceRevision = 'a'.repeat(40)

function createStore(): {
  store: FindingVerificationStore
  records: Map<string, FindingVerificationRecord>
  setSourceRevision(revision: string | null): void
  setOwner(userId: string | null): void
} {
  let currentRevision: string | null = sourceRevision
  let ownerId: string | null = 'owner-1'
  const records = new Map<string, FindingVerificationRecord>()
  return {
    records,
    setSourceRevision(revision) {
      currentRevision = revision
    },
    setOwner(userId) {
      ownerId = userId
    },
    store: {
      async findOwnedFinding(userId, findingId) {
        return userId === ownerId && findingId === 'finding-1'
          ? { id: findingId, sourceRevision: currentRevision }
          : null
      },
      async findOwnedRecord(userId, findingId, requestKey) {
        return userId === ownerId
          ? records.get(`${findingId}:${requestKey}`) ?? null
          : null
      },
      async createUnavailableRecord(input) {
        const current =
          input.sourceRevision !== null && input.sourceRevision === currentRevision
        const record: FindingVerificationRecord = {
          id: `verification-${records.size + 1}`,
          findingId: input.findingId,
          requestKey: input.requestKey,
          status: 'INCONCLUSIVE',
          method: input.method,
          resultSummary: current
            ? 'No isolated verification runner is configured. The requested check was not executed.'
            : input.sourceRevision === null
              ? 'Verification is inconclusive because this review has no pinned source revision.'
              : 'Verification is inconclusive because the review source revision has changed.',
          sourceRevision: input.sourceRevision,
          diagnosticSummary: current
            ? 'No sandbox runner or approved static-analysis tool is configured; no repository code was executed.'
            : 'No verification command was executed; the source revision is stale.',
          executionOccurred: false,
          toolIdentity: null,
          exitCode: null,
          durationMs: 0,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
          createdAt: input.completedAt,
        }
        records.set(`${input.findingId}:${input.requestKey}`, record)
        return record
      },
    },
  }
}

test('owner-scoped check requests are idempotent and remain inconclusive without a runner', async () => {
  const { store, records } = createStore()
  const now = new Date('2026-10-24T10:00:00.000Z')
  const service = new FindingVerificationService(store, () => now)
  const input = { requestKey: 'static-check-1', method: 'STATIC_ANALYSIS' }

  const result = await service.request('owner-1', 'finding-1', input)
  assert.equal(result.status, 'INCONCLUSIVE')
  assert.equal(result.method, 'STATIC_ANALYSIS')
  assert.equal(result.sourceRevision, sourceRevision)
  assert.equal(result.executionOccurred, false)
  assert.equal(result.toolIdentity, null)
  assert.equal(result.exitCode, null)
  assert.equal(result.durationMs, 0)
  assert.match(result.resultSummary, /was not executed/)
  assert.match(result.diagnosticSummary ?? '', /no repository code was executed/)
  assert.equal(result.startedAt.toISOString(), now.toISOString())
  assert.equal(result.completedAt.toISOString(), now.toISOString())

  const duplicate = await service.request('owner-1', 'finding-1', input)
  assert.equal(duplicate.id, result.id)
  assert.equal(records.size, 1)
})

test('rejects unauthorized finding requests and inspection', async () => {
  const { store } = createStore()
  const service = new FindingVerificationService(store)

  await assert.rejects(
    service.request('other-user', 'finding-1', {
      requestKey: 'unauthorized',
      method: 'TARGETED_TEST',
    }),
    FindingVerificationNotFoundError
  )
  await assert.rejects(
    service.get('other-user', 'finding-1', 'missing'),
    FindingVerificationNotFoundError
  )
})

test('records missing and stale source revisions as inconclusive', async () => {
  const { store, setSourceRevision } = createStore()
  const service = new FindingVerificationService(store)

  setSourceRevision(null)
  const missing = await service.request('owner-1', 'finding-1', {
    requestKey: 'missing-revision',
    method: 'STATIC_ANALYSIS',
  })
  assert.equal(missing.status, 'INCONCLUSIVE')
  assert.equal(missing.sourceRevision, null)
  assert.match(missing.resultSummary, /no pinned source revision/)

  setSourceRevision(sourceRevision)
  const createUnavailableRecord = store.createUnavailableRecord.bind(store)
  store.createUnavailableRecord = async (input) => {
    setSourceRevision('b'.repeat(40))
    return createUnavailableRecord(input)
  }
  const stale = await service.request('owner-1', 'finding-1', {
    requestKey: 'stale-revision',
    method: 'TARGETED_TEST',
  })
  assert.equal(stale.status, 'INCONCLUSIVE')
  assert.equal(stale.sourceRevision, sourceRevision)
  assert.match(stale.resultSummary, /source revision has changed/)
})

test('request schema allows only known profiles and never accepts verification results', () => {
  const valid = { requestKey: 'check-1', method: 'STATIC_ANALYSIS' }
  assert.equal(requestFindingVerificationSchema.safeParse(valid).success, true)
  assert.equal(
    requestFindingVerificationSchema.safeParse({
      ...valid,
      method: 'arbitrary-command',
    }).success,
    false
  )
  for (const field of ['status', 'executionOccurred', 'exitCode', 'sourceRevision']) {
    assert.equal(
      requestFindingVerificationSchema.safeParse({
        ...valid,
        [field]: field === 'status' ? 'VERIFIED' : true,
      }).success,
      false,
      `client-supplied ${field} must be rejected`
    )
  }
})

test('limits request keys and rejects malformed identifiers', () => {
  assert.equal(
    requestFindingVerificationSchema.safeParse({
      requestKey: 'x'.repeat(129),
      method: 'STATIC_ANALYSIS',
    }).success,
    false
  )
  assert.equal(
    requestFindingVerificationSchema.safeParse({
      requestKey: 'test/../command',
      method: 'TARGETED_TEST',
    }).success,
    false
  )
  assert.equal(
    requestFindingVerificationSchema.safeParse({
      requestKey: 'ai-review:review-1',
      method: 'STATIC_ANALYSIS',
    }).success,
    false
  )
})

test('bounds independent check requests per finding', async () => {
  const { store, records } = createStore()
  const createUnavailableRecord = store.createUnavailableRecord.bind(store)
  store.createUnavailableRecord = async (input) => {
    if (records.size >= MAX_FINDING_VERIFICATION_REQUESTS) {
      throw new FindingVerificationLimitError()
    }
    return createUnavailableRecord(input)
  }
  const service = new FindingVerificationService(store)

  for (let index = 0; index < MAX_FINDING_VERIFICATION_REQUESTS; index += 1) {
    await service.request('owner-1', 'finding-1', {
      requestKey: `bounded-${index}`,
      method: 'STATIC_ANALYSIS',
    })
  }
  await assert.rejects(
    service.request('owner-1', 'finding-1', {
      requestKey: 'over-limit',
      method: 'STATIC_ANALYSIS',
    }),
    FindingVerificationLimitError
  )
  assert.equal(records.size, MAX_FINDING_VERIFICATION_REQUESTS)
})
