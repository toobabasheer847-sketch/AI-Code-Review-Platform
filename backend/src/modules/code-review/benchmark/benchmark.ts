import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env, hasUsableOpenAIKey } from '@/config/env'
import type { ReviewSourceFile } from '@/modules/github/github.service'
import {
  analyzeCode,
  completeWithOpenAI,
  type ReviewAnalysis,
  type ReviewFinding,
  type ReviewProvider,
} from '../analyzer'
import { z } from 'zod'
import {
  benchmarkDataset,
  validateBenchmarkDataset,
  type BenchmarkExpectedFinding,
  type BenchmarkFixture,
} from './fixtures'

const categories = ['bug', 'security', 'performance', 'quality'] as const
const severities = ['error', 'warning', 'info'] as const
const DEFAULT_LINE_TOLERANCE = 2

type Category = (typeof categories)[number]
type Severity = (typeof severities)[number]
type BenchmarkErrorKind = 'timeout' | 'analyzer_failure'
type MetricCounts = {
  truePositives: number
  falsePositives: number
  falseNegatives: number
  precision: number | null
  recall: number | null
}

export interface BenchmarkOptions {
  mode: 'mock' | 'live'
  timeoutMs?: number
  dataset?: unknown
  now?: () => Date
  analyze?: (
    files: ReviewSourceFile[],
    provider?: ReviewProvider,
    signal?: AbortSignal
  ) => Promise<ReviewAnalysis>
}

interface FindingReference {
  category: Category
  file: string
  line: number
  severity: Severity | null
}

interface FixtureResult {
  fixtureId: string
  expectedFindings: number
  detectedFindings: number
  truePositives: number
  falsePositives: number
  falseNegatives: number
  duplicateFindings: number
  falsePositiveFindings: FindingReference[]
  missedFindings: FindingReference[]
  failure: BenchmarkErrorKind | null
}

export interface BenchmarkReport {
  metadata: {
    datasetVersion: string
    provider: string
    model: string
    configuration: {
      mode: 'mock' | 'live'
      temperature: number | null
      timeoutMs: number
      lineTolerance: number
    }
    timestamp: string
    durationMs: number
  }
  summary: {
    datasetSize: number
    expectedFindings: number
    detectedFindings: number
    truePositives: number
    falsePositives: number
    falseNegatives: number
    precision: number | null
    recall: number | null
    duplicateFindingCount: number
    duplicateFindingRate: number | null
    runtimeMs: number
    failures: number
    byCategory: Record<Category, MetricCounts>
    bySeverity: Record<Severity, MetricCounts>
  }
  results: FixtureResult[]
  errors: Array<{
    fixtureId: string
    kind: 'timeout' | 'analyzer_failure'
    message: string
  }>
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function createCounts(): Omit<MetricCounts, 'precision' | 'recall'> {
  return { truePositives: 0, falsePositives: 0, falseNegatives: 0 }
}

function finishCounts(counts: Omit<MetricCounts, 'precision' | 'recall'>): MetricCounts {
  const predicted = counts.truePositives + counts.falsePositives
  const expected = counts.truePositives + counts.falseNegatives
  return {
    ...counts,
    precision: predicted === 0 ? null : counts.truePositives / predicted,
    recall: expected === 0 ? null : counts.truePositives / expected,
  }
}

function matches(
  expected: BenchmarkExpectedFinding,
  actual: ReviewFinding,
  lineTolerance: number
): boolean {
  const expectedEvidence = normalize(expected.evidence)
  const actualEvidence = normalize(actual.evidence)
  return (
    actual.category === expected.category &&
    actual.file.toLowerCase() === expected.file.toLowerCase() &&
    Math.abs(actual.line - expected.line) <= lineTolerance &&
    (expected.severity === undefined || actual.severity === expected.severity) &&
    (actualEvidence.includes(expectedEvidence) || expectedEvidence.includes(actualEvidence))
  )
}

function duplicateCount(findings: ReviewFinding[]): number {
  const seen = new Set<string>()
  let duplicates = 0
  for (const finding of findings) {
    const key = [
      finding.file.toLowerCase(),
      finding.category,
      finding.line,
      finding.endLine ?? finding.line,
      normalize(finding.evidence),
    ].join('\u0000')
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }
  return duplicates
}

function parseRawFindings(content: string | null): ReviewFinding[] {
  if (!content) return []
  try {
    const parsed: unknown = JSON.parse(content)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'findings' in parsed &&
      Array.isArray(parsed.findings)
    ) {
      const rawFindingSchema = z.array(
        z.object({
          file: z.string(),
          line: z.number().int(),
          endLine: z.number().int().optional(),
          severity: z.enum(severities),
          category: z.enum(categories),
          title: z.string(),
          message: z.string(),
          impact: z.string(),
          evidence: z.string(),
          suggestions: z.array(z.string()),
        })
      )
      const findings = rawFindingSchema.safeParse(parsed.findings)
      return findings.success ? findings.data : []
    }
  } catch {
    return []
  }
  return []
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('benchmark-timeout'))
          controller.abort()
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function analyzeFixture(
  fixture: BenchmarkFixture,
  mode: BenchmarkOptions['mode'],
  timeoutMs: number,
  analyze: NonNullable<BenchmarkOptions['analyze']>
): Promise<{ findings: ReviewFinding[]; duplicateFindings: number }> {
  let rawResponse: string | null = null
  const provider: ReviewProvider = async (messages, signal) => {
    rawResponse =
      mode === 'mock' ? fixture.mockResponse : await completeWithOpenAI(messages, signal)
    return rawResponse
  }
  const result = await withTimeout((signal) => analyze(fixture.files, provider, signal), timeoutMs)
  const rawFindings = parseRawFindings(rawResponse)
  return {
    findings: result.findings,
    duplicateFindings: duplicateCount(rawFindings),
  }
}

function evaluateFixture(
  fixture: BenchmarkFixture,
  findings: ReviewFinding[],
  duplicateFindings: number,
  failure: BenchmarkErrorKind | null,
  categoryCounts: Record<Category, ReturnType<typeof createCounts>>,
  severityCounts: Record<Severity, ReturnType<typeof createCounts>>
): FixtureResult {
  const matchedActual = new Set<number>()
  const matchedExpected = new Set<number>()
  const falsePositiveFindings: FindingReference[] = []
  const missedFindings: FindingReference[] = []

  fixture.expectedFindings.forEach((expected, expectedIndex) => {
    const actualIndex = findings.findIndex(
      (actual, index) =>
        !matchedActual.has(index) && matches(expected, actual, DEFAULT_LINE_TOLERANCE)
    )
    if (actualIndex !== -1) {
      matchedExpected.add(expectedIndex)
      matchedActual.add(actualIndex)
      categoryCounts[expected.category].truePositives += 1
      if (expected.severity) severityCounts[expected.severity].truePositives += 1
    }
  })

  findings.forEach((finding, index) => {
    if (!matchedActual.has(index)) {
      categoryCounts[finding.category].falsePositives += 1
      severityCounts[finding.severity].falsePositives += 1
      falsePositiveFindings.push({
        category: finding.category,
        file: finding.file,
        line: finding.line,
        severity: finding.severity,
      })
    }
  })

  fixture.expectedFindings.forEach((expected, index) => {
    if (!matchedExpected.has(index)) {
      categoryCounts[expected.category].falseNegatives += 1
      if (expected.severity) severityCounts[expected.severity].falseNegatives += 1
      missedFindings.push({
        category: expected.category,
        file: expected.file,
        line: expected.line,
        severity: expected.severity ?? null,
      })
    }
  })

  const truePositives = matchedExpected.size
  const falsePositives = findings.length - matchedActual.size
  const falseNegatives = fixture.expectedFindings.length - matchedExpected.size
  return {
    fixtureId: fixture.id,
    expectedFindings: fixture.expectedFindings.length,
    detectedFindings: findings.length,
    truePositives,
    falsePositives,
    falseNegatives,
    duplicateFindings,
    falsePositiveFindings,
    missedFindings,
    failure,
  }
}

export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkReport> {
  const dataset = validateBenchmarkDataset(options.dataset ?? benchmarkDataset)
  const timeoutMs = options.timeoutMs ?? 60_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('Benchmark timeout must be a positive integer')
  }
  if (options.mode === 'live' && !hasUsableOpenAIKey()) {
    throw new Error('Live benchmark requires a configured OPENAI_API_KEY')
  }

  const analyze =
    options.analyze ??
    ((files: ReviewSourceFile[], provider?: ReviewProvider, signal?: AbortSignal) =>
      provider ? analyzeCode(files, provider, signal) : analyzeCode(files, undefined, signal))
  const startedAt = Date.now()
  const timestamp = (options.now ?? (() => new Date()))().toISOString()
  const categoryCounts = Object.fromEntries(
    categories.map((category) => [category, createCounts()])
  ) as Record<Category, ReturnType<typeof createCounts>>
  const severityCounts = Object.fromEntries(
    severities.map((severity) => [severity, createCounts()])
  ) as Record<Severity, ReturnType<typeof createCounts>>
  const errors: BenchmarkReport['errors'] = []
  const results: FixtureResult[] = []
  let duplicateFindingCount = 0

  for (const fixture of dataset.fixtures) {
    let findings: ReviewFinding[] = []
    let duplicates = 0
    let failure: BenchmarkErrorKind | null = null
    try {
      const result = await analyzeFixture(fixture, options.mode, timeoutMs, analyze)
      findings = result.findings
      duplicates = result.duplicateFindings
    } catch (error) {
      const timedOut = error instanceof Error && error.message === 'benchmark-timeout'
      failure = timedOut ? 'timeout' : 'analyzer_failure'
      errors.push({
        fixtureId: fixture.id,
        kind: failure,
        message: timedOut
          ? 'Analyzer exceeded the configured timeout.'
          : 'Analyzer failed to return a valid review.',
      })
    }
    duplicateFindingCount += duplicates
    results.push(
      evaluateFixture(fixture, findings, duplicates, failure, categoryCounts, severityCounts)
    )
  }

  const truePositives = results.reduce((sum, result) => sum + result.truePositives, 0)
  const falsePositives = results.reduce((sum, result) => sum + result.falsePositives, 0)
  const falseNegatives = results.reduce((sum, result) => sum + result.falseNegatives, 0)
  const expectedFindings = results.reduce((sum, result) => sum + result.expectedFindings, 0)
  const detectedFindings = results.reduce((sum, result) => sum + result.detectedFindings, 0)
  const durationMs = Date.now() - startedAt
  const overallCounts = finishCounts({
    truePositives,
    falsePositives,
    falseNegatives,
  })

  return {
    metadata: {
      datasetVersion: dataset.version,
      provider: options.mode === 'live' ? 'openai' : 'deterministic-mock',
      model: options.mode === 'live' ? env.OPENAI_MODEL : 'fixture-responses',
      configuration: {
        mode: options.mode,
        temperature: options.mode === 'live' ? 0.1 : null,
        timeoutMs,
        lineTolerance: DEFAULT_LINE_TOLERANCE,
      },
      timestamp,
      durationMs,
    },
    summary: {
      datasetSize: dataset.fixtures.length,
      expectedFindings,
      detectedFindings,
      truePositives,
      falsePositives,
      falseNegatives,
      precision: overallCounts.precision,
      recall: overallCounts.recall,
      duplicateFindingCount,
      duplicateFindingRate:
        detectedFindings + duplicateFindingCount === 0
          ? null
          : duplicateFindingCount / (detectedFindings + duplicateFindingCount),
      runtimeMs: durationMs,
      failures: errors.length,
      byCategory: Object.fromEntries(
        categories.map((category) => [category, finishCounts(categoryCounts[category])])
      ) as Record<Category, MetricCounts>,
      bySeverity: Object.fromEntries(
        severities.map((severity) => [severity, finishCounts(severityCounts[severity])])
      ) as Record<Severity, MetricCounts>,
    },
    results,
    errors,
  }
}

export function formatBenchmarkSummary(report: BenchmarkReport): string {
  const metric = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`)
  const lines = [
    `AI-CodeGuard benchmark ${report.metadata.datasetVersion} (${report.metadata.configuration.mode})`,
    `Fixtures: ${report.summary.datasetSize}; expected: ${report.summary.expectedFindings}; detected: ${report.summary.detectedFindings}`,
    `TP: ${report.summary.truePositives}; FP: ${report.summary.falsePositives}; FN: ${report.summary.falseNegatives}`,
    `Precision: ${metric(report.summary.precision)}; recall: ${metric(report.summary.recall)}`,
    `Duplicate findings: ${report.summary.duplicateFindingCount}; duplicate rate: ${metric(report.summary.duplicateFindingRate)}`,
    `Runtime: ${report.summary.runtimeMs} ms; failures: ${report.summary.failures}`,
  ]
  if (report.errors.length > 0) {
    lines.push('Errors:')
    for (const error of report.errors) {
      lines.push(`- ${error.fixtureId}: ${error.message}`)
    }
  }
  return lines.join('\n')
}

async function writeReport(outputPath: string, report: BenchmarkReport): Promise<void> {
  const absolutePath = resolve(outputPath)
  const directory = dirname(absolutePath)
  const extension = extname(absolutePath) || '.json'
  const jsonPath = extname(absolutePath) ? absolutePath : `${absolutePath}.json`
  const summaryPath = join(
    dirname(jsonPath),
    `${basename(jsonPath, extname(jsonPath))}.summary.txt`
  )
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(summaryPath, `${formatBenchmarkSummary(report)}\n`, 'utf8'),
  ])
  process.stdout.write(`Wrote JSON report and summary (${extension || '.json'}).\n`)
}

function parseArguments(args: string[]): {
  mode: 'mock' | 'live'
  timeoutMs: number
  output?: string
  help: boolean
} {
  let mode: 'mock' | 'live' = 'mock'
  let timeoutMs = 60_000
  let output: string | undefined
  let help = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--live') mode = 'live'
    else if (argument === '--help' || argument === '-h') help = true
    else if (argument === '--timeout-ms') {
      const value = args[index + 1]
      if (!value || !/^\d+$/.test(value)) {
        throw new Error('--timeout-ms requires a positive integer')
      }
      timeoutMs = Number(value)
      index += 1
    } else if (argument === '--output') {
      output = args[index + 1]
      if (!output || output.startsWith('--')) {
        throw new Error('--output requires a file path')
      }
      index += 1
    } else {
      throw new Error(`Unknown benchmark option: ${argument}`)
    }
  }
  return { mode, timeoutMs, output, help }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(
      'Usage: npm run benchmark -- [--live] [--timeout-ms <ms>] [--output <path>]\n'
    )
    return
  }
  const report = await runBenchmark({ mode: args.mode, timeoutMs: args.timeoutMs })
  process.stdout.write(`${formatBenchmarkSummary(report)}\n`)
  if (args.output) await writeReport(args.output, report)
  if (report.summary.failures > 0) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error &&
      [
        'Live benchmark requires a configured OPENAI_API_KEY',
        'Benchmark timeout must be a positive integer',
      ].includes(error.message)
        ? error.message
        : 'Benchmark could not be completed; check the supplied options and environment.'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
