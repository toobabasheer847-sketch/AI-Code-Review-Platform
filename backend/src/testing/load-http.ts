import { assertLoadTarget, percentile } from './load-profile'

const requests = Number(process.env.LOAD_TEST_REQUESTS ?? '20')
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? '2')

async function one(url: string): Promise<{ status: number; durationMs: number }> {
  const started = performance.now()
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  return { status: response.status, durationMs: performance.now() - started }
}

async function main(): Promise<void> {
  const target = assertLoadTarget(
    process.env.LOAD_TEST_URL ?? 'http://127.0.0.1:3001/health/live',
    process.env.LOAD_TEST_ALLOW_REMOTE === '1'
  )
  if (!Number.isInteger(requests) || requests < 1 || requests > 200) {
    throw new Error('LOAD_TEST_REQUESTS must be an integer from 1 to 200.')
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error('LOAD_TEST_CONCURRENCY must be an integer from 1 to 10.')
  }

  const samples: Array<{ status: number; durationMs: number }> = []
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < requests) {
      const index = cursor
      cursor += 1
      if (index >= requests) return
      samples.push(await one(target.toString()))
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  const durations = samples.map((sample) => sample.durationMs)
  const errors = samples.filter((sample) => sample.status >= 500).length
  process.stdout.write(
    `${JSON.stringify({
      requests: samples.length,
      concurrency,
      errors,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
    })}\n`
  )
}

const invokedDirectly = process.argv[1]?.includes('load-http')
if (invokedDirectly) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Load test failed.'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
