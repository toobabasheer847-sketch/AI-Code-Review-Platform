import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generateTestSuggestions,
  MAX_TEST_GENERATION_CONTEXT_CHARS,
  parseReviewSourceSnapshot,
  TestGenerationError,
  validateTestSuggestions,
} from './test-generator'
import type { ReviewSourceFile } from '@/modules/github/github.service'

const finding = {
  findingId: 'finding-1',
  file: 'src/handler.ts',
  line: 2,
  title: 'Missing invalid input handling',
  message: 'The handler does not reject invalid input.',
  evidence: 'return value',
  suggestions: ['Reject invalid input.'],
}

const snapshot = [
  '--- src/handler.ts ---',
  'export function handle(value: string) {',
  '  return value.trim()',
  '}',
  '',
  '--- src/handler.test.ts ---',
  "import test from 'node:test'",
  "test('trims input', () => {})",
  '',
].join('\n')

const validResponse = {
  framework: 'node:test via tsx',
  suggestions: [
    {
      name: 'rejects empty input',
      code: "test('rejects empty input', () => { assert.throws(() => handle('')) })",
      explanation: 'Checks invalid input handling.',
      expectedBenefit: 'Covers the empty value edge case.',
      behaviorChanging: false,
    },
  ],
}

test('parses persisted review source snapshots into path/content entries', () => {
  assert.deepEqual(parseReviewSourceSnapshot(snapshot), [
    {
      path: 'src/handler.ts',
      content: 'export function handle(value: string) {\n  return value.trim()\n}',
    },
    {
      path: 'src/handler.test.ts',
      content: "import test from 'node:test'\ntest('trims input', () => {})",
    },
  ])
})

test('generates bounded node:test previews with relevant existing tests and no execution', async () => {
  let prompt = ''
  const result = await generateTestSuggestions(
    snapshot,
    finding,
    async (submitted) => {
      prompt = submitted
      return JSON.stringify(validResponse)
    }
  )

  assert.equal(result.previewOnly, true)
  assert.equal(result.framework, 'node:test via tsx')
  assert.equal(result.suggestions.length, 1)
  assert.match(prompt, /test\('trims input'/)
  assert.match(prompt, /Do not repeat any existing test names or behaviors/)
  assert.ok(prompt.length < MAX_TEST_GENERATION_CONTEXT_CHARS + 4_000)
})

test('uses the frontend Vitest framework for frontend source previews', async () => {
  let prompt = ''
  const response = {
    ...validResponse,
    framework: 'vitest',
    suggestions: [
      {
        ...validResponse.suggestions[0],
        code: "import { it, expect } from 'vitest'; it('renders empty state', () => { expect(true).toBe(true) })",
      },
    ],
  }
  const frontendSnapshot = [
    '--- frontend/src/handler.ts ---',
    'export function handle(value: string) { return value.trim() }',
    '',
    '--- frontend/src/handler.test.ts ---',
    "import { it } from 'vitest'; it('trims input', () => {})",
  ].join('\n')

  const result = await generateTestSuggestions(
    frontendSnapshot,
    { ...finding, file: 'frontend/src/handler.ts' },
    async (submitted) => {
      prompt = submitted
      return JSON.stringify(response)
    }
  )

  assert.equal(result.framework, 'vitest')
  assert.equal(result.previewOnly, true)
  assert.match(prompt, /Use the repository's vitest framework/)
  assert.match(prompt, /it\('trims input'/)
})

test('removes existing and repeated generated test names', () => {
  const existing: ReviewSourceFile[] = [
    {
      path: 'src/handler.test.ts',
      content: "test('trims input', () => {})",
    },
  ]
  const result = validateTestSuggestions(
    {
      ...validResponse,
      suggestions: [
        {
          ...validResponse.suggestions[0],
          name: 'trims input',
          code: "test('rejects empty input', () => assert.throws(() => handle('')))",
        },
        {
          ...validResponse.suggestions[0],
          name: 'different title, same test',
          code: "test('different title, same test', () => {})",
        },
        {
          ...validResponse.suggestions[0],
          name: 'rejects null input',
          code: "test('rejects null input', () => assert.throws(() => handle(null)))",
        },
      ],
    },
    existing
  )

  assert.deepEqual(result.suggestions.map(({ name }) => name), ['rejects null input'])
  assert.equal(result.duplicateCount, 2)
})

test('rejects unsupported source languages without calling the provider', async () => {
  let providerCalled = false
  await assert.rejects(
    generateTestSuggestions(
      '--- src/handler.py ---\ndef handle(value): return value',
      { ...finding, file: 'src/handler.py' },
      async () => {
        providerCalled = true
        return JSON.stringify(validResponse)
      }
    ),
    (error: unknown) =>
      error instanceof TestGenerationError && error.kind === 'unsupported_language'
  )
  assert.equal(providerCalled, false)
})

test('returns safe errors for malformed provider output and provider failures', async () => {
  await assert.rejects(
    generateTestSuggestions(snapshot, finding, async () => '{invalid'),
    (error: unknown) =>
      error instanceof TestGenerationError && error.kind === 'malformed_response'
  )
  await assert.rejects(
    generateTestSuggestions(
      snapshot,
      finding,
      async () =>
        JSON.stringify({
          ...validResponse,
          framework: 'vitest',
        })
    ),
    (error: unknown) =>
      error instanceof TestGenerationError && error.kind === 'malformed_response'
  )
  await assert.rejects(
    generateTestSuggestions(
      snapshot,
      finding,
      async () =>
        JSON.stringify({
          ...validResponse,
          suggestions: [
            { ...validResponse.suggestions[0], code: "test('broken', () => {" },
          ],
        })
    ),
    (error: unknown) =>
      error instanceof TestGenerationError && error.kind === 'malformed_response'
  )
  await assert.rejects(
    generateTestSuggestions(snapshot, finding, async () => {
      throw new Error('provider response with private details')
    }),
    (error: unknown) =>
      error instanceof TestGenerationError &&
      error.kind === 'provider_failure' &&
      !error.message.includes('private details')
  )
})

test('classifies provider timeouts without exposing provider details', async () => {
  await assert.rejects(
    generateTestSuggestions(snapshot, finding, async () => {
      throw Object.assign(new Error('internal timeout diagnostics'), {
        name: 'APIConnectionTimeoutError',
      })
    }),
    (error: unknown) =>
      error instanceof TestGenerationError &&
      error.kind === 'timeout' &&
      !error.message.includes('internal')
  )
})
