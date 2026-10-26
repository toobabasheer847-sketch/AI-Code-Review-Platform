import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeCodeQuality,
  MAX_FUNCTION_CYCLOMATIC_COMPLEXITY,
  QualityAnalysisError,
} from './quality-analyzer'
import type { ReviewSourceFile } from '@/modules/github/github.service'

const makeFunction = (branches: number): string =>
  [
    'export function branchy(value: number): number {',
    ...Array.from(
      { length: branches },
      (_, index) => `  if (value > ${index}) value -= 1;`
    ),
    '  return value;',
    '}',
  ].join('\n')

test('reports function complexity above the configured threshold with evidence and remediation', () => {
  const source: ReviewSourceFile = {
    path: 'src/service.ts',
    content: makeFunction(MAX_FUNCTION_CYCLOMATIC_COMPLEXITY),
  }

  const result = analyzeCodeQuality([source])

  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0]?.source, 'STATIC_ANALYSIS')
  assert.equal(result.findings[0]?.category, 'quality')
  assert.equal(result.findings[0]?.line, 1)
  assert.equal(result.findings[0]?.endLine, source.content.split('\n').length)
  assert.match(result.findings[0]?.message ?? '', /complexity of 11/)
  assert.match(result.findings[0]?.evidence ?? '', /function branchy/)
  assert.match(result.findings[0]?.suggestions[0] ?? '', /helper functions/)
  assert.deepEqual(result.limitations, [])
})

test('does not report functions at or below the configured complexity threshold', () => {
  const result = analyzeCodeQuality([
    { path: 'src/simple.js', content: makeFunction(MAX_FUNCTION_CYCLOMATIC_COMPLEXITY - 1) },
  ])

  assert.equal(result.findings.length, 0)
})

test('counts nested decisions but does not attribute nested functions to the outer function', () => {
  const result = analyzeCodeQuality([
    {
      path: 'src/nested.ts',
      content: [
        'function outer(value: number) {',
        '  const inner = () => {',
        ...Array.from(
          { length: MAX_FUNCTION_CYCLOMATIC_COMPLEXITY },
          (_, index) => `    if (value > ${index}) return value;`
        ),
        '  };',
        '  return inner();',
        '}',
      ].join('\n'),
    },
  ])

  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0]?.line, 2)
  assert.match(result.findings[0]?.message ?? '', /complexity of 11/)
})

test('skips unsupported and syntactically malformed source with explicit limitations', () => {
  const result = analyzeCodeQuality([
    { path: 'assets/app.py', content: 'def f(): pass' },
    { path: 'src/broken.ts', content: 'function broken( {' },
  ])

  assert.equal(result.findings.length, 0)
  assert.match(result.limitations.join(' '), /1 unsupported file/)
  assert.match(result.limitations.join(' '), /1 file\(s\) with syntax errors/)
})

test('ignores findings outside changed pull-request lines', () => {
  const content = `const unchanged = true;\n${makeFunction(MAX_FUNCTION_CYCLOMATIC_COMPLEXITY)}`
  const result = analyzeCodeQuality([
    {
      path: 'src/service.ts',
      content,
      changedLines: [1],
    },
  ])

  assert.equal(result.findings.length, 0)
})

test('rejects malformed and over-limit source and reports timeouts explicitly', () => {
  assert.throws(
    () => analyzeCodeQuality([{ path: 'src/a.ts', content: null } as unknown as ReviewSourceFile]),
    QualityAnalysisError
  )
  assert.throws(
    () => analyzeCodeQuality([{ path: 'src/a.ts', content: 'x'.repeat(20_001) }]),
    /file size limit/
  )
  assert.throws(
    () =>
      analyzeCodeQuality([{ path: 'src/a.ts', content: 'const x = 1' }], {
        now: (() => {
          let clock = 0
          return () => clock++ * 2
        })(),
        maxDurationMs: 1,
      }),
    /timed out/
  )
})
