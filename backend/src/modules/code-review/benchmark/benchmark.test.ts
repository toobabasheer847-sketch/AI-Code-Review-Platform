import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReviewAnalysis } from '../analyzer'
import { formatBenchmarkSummary, runBenchmark } from './benchmark'
import { benchmarkDataset, validateBenchmarkDataset } from './fixtures'

test('measures true positives, misses, false positives, and provider duplicates', async () => {
  const report = await runBenchmark({
    mode: 'mock',
    now: () => new Date('2026-10-24T00:00:00.000Z'),
  })

  assert.equal(report.metadata.datasetVersion, '1.0.0')
  assert.equal(report.metadata.model, 'fixture-responses')
  assert.equal(report.summary.datasetSize, 7)
  assert.equal(report.summary.expectedFindings, 5)
  assert.equal(report.summary.detectedFindings, 5)
  assert.equal(report.summary.truePositives, 4)
  assert.equal(report.summary.falsePositives, 1)
  assert.equal(report.summary.falseNegatives, 1)
  assert.equal(report.summary.precision, 0.8)
  assert.equal(report.summary.recall, 0.8)
  assert.equal(report.summary.duplicateFindingCount, 1)
  assert.equal(report.summary.duplicateFindingRate, 1 / 6)
  assert.equal(
    report.results.find((result) => result.fixtureId === 'duplicate-provider-findings')
      ?.duplicateFindings,
    1
  )
  assert.deepEqual(report.summary.byCategory.bug, {
    truePositives: 3,
    falsePositives: 0,
    falseNegatives: 1,
    precision: 1,
    recall: 0.75,
  })
  assert.deepEqual(report.summary.bySeverity.error, {
    truePositives: 3,
    falsePositives: 0,
    falseNegatives: 0,
    precision: 1,
    recall: 1,
  })
})

test('returns null for undefined zero-denominator metrics', async () => {
  const cleanDataset = validateBenchmarkDataset({
    version: '1.0.0',
    fixtures: [
      {
        id: 'clean-only',
        description: 'A clean synthetic sample.',
        files: [{ path: 'src/clean.ts', content: 'export const ready = true' }],
        expectedFindings: [],
        mockResponse: JSON.stringify({ summary: 'Clean.', findings: [] }),
      },
    ],
  })
  const report = await runBenchmark({ mode: 'mock', dataset: cleanDataset })

  assert.equal(report.summary.truePositives, 0)
  assert.equal(report.summary.precision, null)
  assert.equal(report.summary.recall, null)
  assert.equal(report.summary.duplicateFindingRate, null)
  assert.equal(report.summary.byCategory.bug.precision, null)
  assert.equal(report.summary.byCategory.bug.recall, null)
})

test('reports an empty dataset without presenting undefined metrics as measured', async () => {
  const report = await runBenchmark({
    mode: 'mock',
    dataset: { version: '1.0.0', fixtures: [] },
  })

  assert.equal(report.summary.datasetSize, 0)
  assert.equal(report.summary.expectedFindings, 0)
  assert.equal(report.summary.detectedFindings, 0)
  assert.equal(report.summary.precision, null)
  assert.equal(report.summary.recall, null)
  assert.equal(report.summary.duplicateFindingRate, null)
})

test('assigns duplicate model output to one expected finding only', async () => {
  const fixture = benchmarkDataset.fixtures.find(
    (candidate) => candidate.id === 'duplicate-provider-findings'
  )
  assert.ok(fixture)
  const report = await runBenchmark({
    mode: 'mock',
    dataset: { version: '1.0.0', fixtures: [fixture] },
  })

  assert.equal(report.summary.truePositives, 1)
  assert.equal(report.summary.falsePositives, 0)
  assert.equal(report.summary.detectedFindings, 1)
  assert.equal(report.summary.duplicateFindingCount, 1)
})

test('rejects invalid expected fixture locations and duplicate fixture IDs', () => {
  assert.throws(
    () =>
      validateBenchmarkDataset({
        version: '1.0.0',
        fixtures: [
          {
            id: 'invalid-location',
            description: 'Invalid ground truth.',
            files: [{ path: 'src/a.ts', content: 'export const a = 1' }],
            expectedFindings: [
              {
                file: 'src/a.ts',
                line: 3,
                category: 'bug',
                evidence: 'missing',
              },
            ],
            mockResponse: '{"summary":"x","findings":[]}',
          },
        ],
      }),
    /invalid expected finding location/
  )

  const fixture = benchmarkDataset.fixtures[0]
  assert.throws(
    () =>
      validateBenchmarkDataset({
        version: '1.0.0',
        fixtures: [fixture, fixture],
      }),
    /IDs must be unique/
  )
})

test('records malformed model output as a sanitized analyzer failure and miss', async () => {
  const fixture = benchmarkDataset.fixtures[0]
  const malformed = {
    ...fixture,
    mockResponse: 'SENSITIVE_SYNTHETIC_MARKER {invalid',
  }
  const report = await runBenchmark({
    mode: 'mock',
    dataset: { version: '1.0.0', fixtures: [malformed] },
  })

  assert.equal(report.summary.failures, 1)
  assert.equal(report.summary.falseNegatives, 1)
  assert.equal(report.errors[0].kind, 'analyzer_failure')
  assert.equal(JSON.stringify(report).includes('SENSITIVE_SYNTHETIC_MARKER'), false)
  assert.equal(report.results[0].missedFindings.length, 1)
})

test('handles analyzer timeout without leaking the pending response', async () => {
  const fixture = benchmarkDataset.fixtures[0]
  let signalAborted = false
  const report = await runBenchmark({
    mode: 'mock',
    timeoutMs: 5,
    dataset: { version: '1.0.0', fixtures: [fixture] },
    analyze: (_files, _provider, signal) =>
      new Promise<ReviewAnalysis>(() => {
        signal?.addEventListener('abort', () => {
          signalAborted = true
        })
      }),
  })

  assert.equal(report.summary.failures, 1)
  assert.equal(report.errors[0].kind, 'timeout')
  assert.equal(report.summary.falseNegatives, fixture.expectedFindings.length)
  assert.equal(signalAborted, true)
})

test('keeps reports free of source and provider response text and is repeatable', async () => {
  const marker = 'SENSITIVE_SYNTHETIC_MARKER'
  const dataset = validateBenchmarkDataset({
    version: '2.1.0',
    fixtures: [
      {
        id: 'sanitized',
        description: 'Synthetic fixture.',
        files: [{ path: 'src/synthetic.ts', content: `const value = "${marker}"` }],
        expectedFindings: [],
        mockResponse: JSON.stringify({
          summary: marker,
          findings: [],
        }),
      },
    ],
  })
  const options = {
    mode: 'mock' as const,
    dataset,
    now: () => new Date('2026-10-24T00:00:00.000Z'),
  }
  const first = await runBenchmark(options)
  const second = await runBenchmark(options)

  assert.equal(JSON.stringify(first).includes(marker), false)
  assert.equal(JSON.stringify(first.results), JSON.stringify(second.results))
  assert.equal(first.metadata.timestamp, second.metadata.timestamp)
  assert.match(formatBenchmarkSummary(first), /Precision: n\/a; recall: n\/a/)
})
