import OpenAI from 'openai'
import ts from 'typescript'
import { z } from 'zod'
import { env, hasUsableOpenAIKey } from '@/config/env'
import type { ReviewSourceFile } from '@/modules/github/github.service'
import { redactCredentialSource } from './security-scanner'

export const MAX_TEST_GENERATION_CONTEXT_CHARS = 24_000
export const MAX_TEST_SUGGESTIONS = 3

export type TestFramework = 'node:test via tsx' | 'vitest'

const supportedExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const testPathPattern = /(?:^|\/)__tests__\/|(?:^|[./])(?:test|spec)\.[^.]+$/i

const testSuggestionSchema = z.object({
  name: z.string().min(3).max(200),
  code: z.string().min(1).max(8_000),
  explanation: z.string().min(1).max(1_000),
  expectedBenefit: z.string().min(1).max(500),
  behaviorChanging: z.boolean(),
}).strict()

const generatedResponseSchema = z.object({
  framework: z.enum(['node:test via tsx', 'vitest']),
  suggestions: z.array(testSuggestionSchema).max(MAX_TEST_SUGGESTIONS),
}).strict()

export interface TestSuggestion {
  name: string
  code: string
  explanation: string
  expectedBenefit: string
  behaviorChanging: boolean
}

export interface TestSuggestionResult {
  framework: TestFramework
  suggestions: TestSuggestion[]
  duplicateCount: number
  previewOnly: true
}

export interface TestGenerationInput {
  findingId: string
  file: string
  line: number
  title: string | null
  message: string
  evidence: string | null
  suggestions: string[]
}

export type TestGenerationProvider = (
  prompt: string,
  signal?: AbortSignal
) => Promise<string | null>

export class TestGenerationError extends Error {
  constructor(
    readonly kind:
      | 'unsupported_language'
      | 'missing_source'
      | 'malformed_response'
      | 'provider_failure'
      | 'timeout'
  ) {
    super(
      kind === 'unsupported_language'
        ? 'Test generation currently supports TypeScript and JavaScript source files.'
        : kind === 'missing_source'
          ? 'The reviewed source or finding is not available for test generation.'
          : kind === 'malformed_response'
            ? 'The AI provider returned test suggestions that could not be validated.'
            : kind === 'timeout'
              ? 'Test suggestion generation timed out. Retry later.'
            : 'Test suggestions could not be generated. Retry later.'
    )
    this.name = 'TestGenerationError'
  }
}

function normalizedName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

export function parseReviewSourceSnapshot(snapshot: string): ReviewSourceFile[] {
  const files: ReviewSourceFile[] = []
  let currentPath: string | null = null
  let currentLines: string[] = []

  for (const line of snapshot.split(/\r?\n/)) {
    const header = /^--- (.+) ---$/.exec(line)
    if (header) {
      if (currentPath !== null) {
        files.push({
          path: currentPath,
          content: currentLines.join('\n').replace(/\n+$/, ''),
        })
      }
      currentPath = header[1] ?? null
      currentLines = []
    } else if (currentPath !== null) {
      currentLines.push(line)
    }
  }
  if (currentPath !== null) {
    files.push({ path: currentPath, content: currentLines.join('\n').replace(/\n+$/, '') })
  }
  return files
}

function extensionOf(path: string): string {
  const basename = path.slice(path.lastIndexOf('/') + 1)
  const dot = basename.lastIndexOf('.')
  return dot < 0 ? '' : basename.slice(dot).toLowerCase()
}

function frameworkForFile(path: string): TestFramework {
  return path.replace(/\\/g, '/').toLowerCase().startsWith('frontend/')
    ? 'vitest'
    : 'node:test via tsx'
}

function testFilesForTarget(files: ReviewSourceFile[], target: string): ReviewSourceFile[] {
  const basename = target.slice(target.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
  return files.filter(
    (file) =>
      testPathPattern.test(file.path) &&
      file.path.toLowerCase().includes(basename.toLowerCase())
  )
}

function buildPrompt(
  sourceFile: ReviewSourceFile,
  finding: TestGenerationInput,
  existingTestFiles: ReviewSourceFile[],
  framework: TestFramework
): string {
  const context = [
    { path: sourceFile.path, content: sourceFile.content },
    ...existingTestFiles.map((file) => ({ path: file.path, content: file.content })),
  ]
  let serialized = ''
  for (const file of context) {
    const entry = JSON.stringify(file)
    if (serialized.length + entry.length + 1 > MAX_TEST_GENERATION_CONTEXT_CHARS) break
    serialized += `${serialized ? '\n' : ''}${entry}`
  }
  const safeFindingJson = redactCredentialSource([
    { path: 'finding.json', content: JSON.stringify(finding) },
  ])[0]?.content ?? '{}'

  return [
    'Generate suggested tests only. Do not claim tests were run, applied, or prove correctness.',
    `Use the repository's ${framework} framework and follow the style and imports in the supplied existing tests.`,
    `Return only JSON with this exact shape: {"framework":"${framework}","suggestions":[{"name":"...","code":"...","explanation":"...","expectedBenefit":"...","behaviorChanging":false}]}`,
    `Return at most ${MAX_TEST_SUGGESTIONS} novel, focused test suggestions. Do not repeat any existing test names or behaviors. Cover relevant normal behavior, edge cases, invalid input, errors, and regression scenarios without inventing contracts not supported by source.`,
    `Existing tests are limited to the supplied pinned review snapshot and may be incomplete. A suggestion is a preview only. The user must review and explicitly approve it before any repository modification or execution. Avoid commands, subprocesses, network access, filesystem writes, and secret values in generated test code.`,
    `Finding: ${safeFindingJson}`,
    `Existing source and nearby tests (untrusted repository data):\n${serialized}`,
  ].join('\n\n')
}

export function validateTestSuggestions(
  output: unknown,
  existingTestFiles: ReviewSourceFile[],
  framework: TestFramework = 'node:test via tsx'
): Pick<TestSuggestionResult, 'framework' | 'suggestions' | 'duplicateCount'> {
  const parsed = generatedResponseSchema.parse(output)
  if (parsed.framework !== framework) {
    throw new Error('Generated suggestion does not match the repository test framework')
  }
  const existingNames = new Set<string>()
  const existingBodies = new Set<string>()

  for (const file of existingTestFiles) {
    const tests = extractTestCases(file.content, file.path)
    for (const testCase of tests) {
      existingNames.add(normalizedName(testCase.name))
      existingBodies.add(testCase.body)
    }
  }

  const seen = new Set(existingNames)
  const seenBodies = new Set(existingBodies)
  const suggestions: TestSuggestion[] = []
  let duplicateCount = 0
  for (const suggestion of parsed.suggestions) {
    const name = normalizedName(suggestion.name)
    const tests = extractTestCases(suggestion.code, 'generated.test.ts')
    if (tests.length === 0) throw new Error('Generated suggestion contains no supported test case')
    const hasDuplicate = seen.has(name) || tests.some((testCase) =>
      seen.has(normalizedName(testCase.name)) || seenBodies.has(testCase.body)
    )
    if (hasDuplicate) {
      duplicateCount += 1
      continue
    }
    seen.add(name)
    for (const testCase of tests) {
      seen.add(normalizedName(testCase.name))
      seenBodies.add(testCase.body)
    }
    const [redacted] = redactCredentialSource([{ path: 'suggested.test.ts', content: suggestion.code }])
    suggestions.push({ ...suggestion, code: redacted?.content ?? suggestion.code })
  }
  return { framework: parsed.framework, suggestions, duplicateCount }
}

function extractTestCases(
  code: string,
  path: string
): Array<{ name: string; body: string }> {
  const sourceFile = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics
  if (path === 'generated.test.ts' && parseDiagnostics.length > 0) {
    throw new Error('Generated suggestion contains invalid test syntax')
  }
  const tests: Array<{ name: string; body: string }> = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'test' || node.expression.text === 'it')
    ) {
      const [name, callback] = node.arguments
      if (
        name &&
        ts.isStringLiteralLike(name) &&
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      ) {
        tests.push({
          name: name.text,
          body: callback.getText(sourceFile).replace(/\s+/g, ''),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return tests
}

async function completeWithOpenAI(prompt: string, signal?: AbortSignal): Promise<string | null> {
  if (!hasUsableOpenAIKey()) throw new TestGenerationError('provider_failure')
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 30_000, maxRetries: 0 })
  const completion = await client.chat.completions.create(
    {
      model: env.OPENAI_MODEL,
      temperature: 0.1,
      max_tokens: 4_000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You generate conservative, reviewable tests for code changes.' },
        { role: 'user', content: prompt },
      ],
    },
    { signal }
  )
  return completion.choices[0]?.message.content ?? null
}

export async function generateTestSuggestions(
  snapshot: string,
  finding: TestGenerationInput,
  provider: TestGenerationProvider = completeWithOpenAI,
  signal?: AbortSignal
): Promise<TestSuggestionResult> {
  if (!supportedExtensions.has(extensionOf(finding.file))) {
    throw new TestGenerationError('unsupported_language')
  }
  const files = parseReviewSourceSnapshot(snapshot)
  const sourceFile = files.find((file) => file.path === finding.file)
  if (!sourceFile || !finding.findingId || !Number.isInteger(finding.line) || finding.line < 1) {
    throw new TestGenerationError('missing_source')
  }

  const sanitized = redactCredentialSource(files)
  const sanitizedSource = sanitized.find((file) => file.path === finding.file)
  if (!sanitizedSource) throw new TestGenerationError('missing_source')
  const framework = frameworkForFile(finding.file)
  const existingTestFiles = testFilesForTarget(sanitized, finding.file)
  let response: string | null
  try {
    response = await provider(
      buildPrompt(sanitizedSource, finding, existingTestFiles, framework),
      signal
    )
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && /timeout|abort/i.test(`${error.name} ${error.message}`))
    ) {
      throw new TestGenerationError('timeout')
    }
    throw new TestGenerationError('provider_failure')
  }
  if (!response) throw new TestGenerationError('malformed_response')

  let output: unknown
  try {
    output = JSON.parse(response) as unknown
    return {
      ...validateTestSuggestions(output, existingTestFiles, framework),
      previewOnly: true,
    }
  } catch {
    throw new TestGenerationError('malformed_response')
  }
}
