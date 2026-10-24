import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FindingVerificationService,
  recordFindingVerificationSchema,
  type FindingVerificationRecord,
  type FindingVerificationStore,
} from './finding-verification.service'

const sourceRevision = 'a'.repeat(40)

function createStore(): {
  store: FindingVerificationStore
  records: Map<string, FindingVerificationRecord>
  setSourceRevision(revision: string): void
} {
  let currentRevision = sourceRevision
  const records = new Map<string, FindingVerificationRecord>()
  return {
    records,
    setSourceRevision(revision) {
      currentRevision = revision
    },
    store: {
      async findRecord(findingId, requestKey) {
        return records.get(`${findingId}:${requestKey}`) ?? null
      },
      async createRecord(input) {
        const isCurrent = currentRevision === input.sourceRevision
        const record: FindingVerificationRecord = {
          id: `verification-${records.size + 1}`,
          findingId: input.findingId,
          requestKey: input.requestKey,
          status: isCurrent ? input.status : 'INCONCLUSIVE',
          method: input.method,
          resultSummary: isCurrent
            ? input.resultSummary
            : 'Verification result was discarded because the review source revision has changed.',
          sourceRevision: input.sourceRevision,
          diagnosticSummary: isCurrent
            ? input.diagnosticSummary
            : 'The result applies to a stale source revision and was not used.',
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

test('records trusted verification outcomes, sanitizes diagnostics, and retries idempotently', async () => {
  const { store, records } = createStore()
  const now = new Date('2026-10-24T10:00:00.000Z')
  const service = new FindingVerificationService(store, () => now)
  const input = {
    requestKey: 'static-check-1',
    status: 'VERIFIED',
    method: 'STATIC_ANALYSIS',
    resultSummary: 'The targeted analyzer rule passed.',
    diagnosticSummary: 'authorization: bearer secret-value',
    sourceRevision,
  }

  const result = await service.record('finding-1', input)
  assert.equal(result.status, 'VERIFIED')
  assert.equal(result.sourceRevision, sourceRevision)
  assert.equal(result.startedAt.toISOString(), now.toISOString())
  assert.equal(result.completedAt.toISOString(), now.toISOString())
  assert.equal(result.diagnosticSummary, 'authorization: bearer [REDACTED]')

  const duplicate = await service.record('finding-1', {
    ...input,
    status: 'VERIFICATION_FAILED',
  })
  assert.equal(duplicate.id, result.id)
  assert.equal(records.size, 1)
})

test('stale source revisions become inconclusive and do not claim verification', async () => {
  const { store, setSourceRevision } = createStore()
  setSourceRevision('b'.repeat(40))
  const service = new FindingVerificationService(store)

  const result = await service.record('finding-1', {
    requestKey: 'stale-test-result',
    status: 'VERIFIED',
    method: 'TARGETED_TEST',
    resultSummary: 'The test passed.',
    sourceRevision,
  })

  assert.equal(result.status, 'INCONCLUSIVE')
  assert.equal(result.sourceRevision, sourceRevision)
  assert.match(result.resultSummary, /source revision has changed/)
  assert.match(result.diagnosticSummary ?? '', /stale source revision/)
})

test('persists failed targeted checks distinctly and permits a separate retry', async () => {
  const { store, records } = createStore()
  const service = new FindingVerificationService(store)

  const failed = await service.record('finding-1', {
    requestKey: 'targeted-test-attempt-1',
    status: 'VERIFICATION_FAILED',
    method: 'TARGETED_TEST',
    resultSummary: 'The targeted regression test still reproduces the reported issue.',
    sourceRevision,
  })
  const retry = await service.record('finding-1', {
    requestKey: 'targeted-test-attempt-2',
    status: 'INCONCLUSIVE',
    method: 'TARGETED_TEST',
    resultSummary: 'The retry timed out.',
    sourceRevision,
  })

  assert.equal(failed.status, 'VERIFICATION_FAILED')
  assert.equal(retry.status, 'INCONCLUSIVE')
  assert.equal(records.size, 2)
})

test('does not accept AI-reported or client-controlled verification fields as trusted results', () => {
  const valid = {
    requestKey: 'verification',
    status: 'VERIFIED',
    method: 'STATIC_ANALYSIS',
    resultSummary: 'A defined independent criterion passed.',
    sourceRevision,
  }
  assert.equal(recordFindingVerificationSchema.safeParse(valid).success, true)
  assert.equal(
    recordFindingVerificationSchema.safeParse({ ...valid, status: 'AI_REPORTED' }).success,
    false
  )
  assert.equal(
    recordFindingVerificationSchema.safeParse({
      ...valid,
      independentlyVerifiedAt: new Date().toISOString(),
    }).success,
    false
  )
})
