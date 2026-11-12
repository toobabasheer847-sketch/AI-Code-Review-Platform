import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assessConfidence,
  confidenceMeaning,
  normalizeSeverity,
  stampMeasuredFinding,
} from './review-intelligence'

test('classifies confidence and keeps critical distinct from a legacy error', () => {
  assert.equal(assessConfidence(0.59).include, false)
  assert.equal(assessConfidence(0.6).disposition, 'potential')
  assert.equal(assessConfidence(0.84).disposition, 'potential')
  assert.equal(assessConfidence(0.85).disposition, 'confirmed')
  assert.equal(assessConfidence(undefined).confidence, null)
  assert.match(confidenceMeaning(0.9, false), /directly demonstrated/)
  assert.match(confidenceMeaning(0.7, false), /potential risk/)
  assert.match(confidenceMeaning(null, true), /did not supply a confidence score/)

  assert.deepEqual(normalizeSeverity({ severity: 'error' }), { severity: 'error', riskLevel: 'high' })
  assert.deepEqual(normalizeSeverity({ severity: 'critical', riskLevel: 'critical' }), {
    severity: 'error',
    riskLevel: 'critical',
  })
  assert.deepEqual(normalizeSeverity({ severity: 'informational' }), {
    severity: 'info',
    riskLevel: 'informational',
  })
})

test('rejects measured findings below the reporting threshold', () => {
  assert.throws(() =>
    stampMeasuredFinding(
      { file: 'src/a.ts', line: 1 },
      { confidence: 0.59, riskLevel: 'low', issueClass: 'quality' }
    )
  )
  const finding = stampMeasuredFinding(
    { file: 'src/a.ts', line: 1 },
    { confidence: 0.72, riskLevel: 'medium', issueClass: 'data_access' }
  )
  assert.equal(finding.disposition, 'potential')
  assert.equal(finding.severity, 'warning')
  assert.equal(finding.issueClass, 'data_access')
})
