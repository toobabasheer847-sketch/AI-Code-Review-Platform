export interface HttpObservation {
  at: number
  status: number
  durationMs: number
}

export interface JobObservation {
  at: number
  queue: 'reviews' | 'email' | 'automations' | 'social' | 'fix-verification'
  outcome: 'succeeded' | 'failed'
}

export interface AIObservation {
  at: number
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  failed: boolean
  unpriced: boolean
}

export interface MetricsSnapshot {
  windowMs: number
  generatedAt: string
  http: {
    requests: number
    serverErrors: number
    authenticationFailures: number
    rateLimitEvents: number
    errorRate: number | null
    latencyMs: { count: number; sum: number; max: number | null; p95: number | null }
  }
  dependencies: { database: 'ok' | 'unavailable' | 'unknown'; redis: 'ok' | 'unavailable' | 'unknown' }
  ai: {
    requests: number
    failedRequests: number
    inputTokens: number
    outputTokens: number
    estimatedCostUsd: number
    unpricedRequests: number
  }
  jobs: Record<JobObservation['queue'], { succeeded: number; failed: number }>
}

const WINDOW_MS = 5 * 60 * 1000
const MAX_SAMPLES = 5_000

const httpSamples: HttpObservation[] = []
const jobSamples: JobObservation[] = []
const aiSamples: AIObservation[] = []
let databaseState: MetricsSnapshot['dependencies']['database'] = 'unknown'
let redisState: MetricsSnapshot['dependencies']['redis'] = 'unknown'

function remember<T extends { at: number }>(samples: T[], sample: T): void {
  samples.push(sample)
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES)
}

export function recordHttpObservation(observation: HttpObservation): void {
  remember(httpSamples, observation)
}

export function recordJobOutcome(observation: JobObservation): void {
  remember(jobSamples, observation)
}

export function recordAIUsage(observation: AIObservation): void {
  remember(aiSamples, observation)
}

export function recordDependencyStatus(
  dependency: 'database' | 'redis',
  state: 'ok' | 'unavailable'
): void {
  if (dependency === 'database') databaseState = state
  else redisState = state
}

export function resetMetrics(): void {
  httpSamples.length = 0
  jobSamples.length = 0
  aiSamples.length = 0
  databaseState = 'unknown'
  redisState = 'unknown'
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? null
}

function emptyJobs(): MetricsSnapshot['jobs'] {
  return {
    reviews: { succeeded: 0, failed: 0 },
    email: { succeeded: 0, failed: 0 },
    automations: { succeeded: 0, failed: 0 },
    social: { succeeded: 0, failed: 0 },
    'fix-verification': { succeeded: 0, failed: 0 },
  }
}

export function metricsSnapshot(now = Date.now(), windowMs = WINDOW_MS): MetricsSnapshot {
  const start = now - windowMs
  const http = httpSamples.filter((sample) => sample.at >= start && sample.at <= now)
  const jobs = jobSamples.filter((sample) => sample.at >= start && sample.at <= now)
  const ai = aiSamples.filter((sample) => sample.at >= start && sample.at <= now)
  const durations = http.map((sample) => sample.durationMs)
  const serverErrors = http.filter((sample) => sample.status >= 500).length
  const jobCounts = emptyJobs()
  for (const sample of jobs) {
    jobCounts[sample.queue][sample.outcome] += 1
  }

  return {
    windowMs,
    generatedAt: new Date(now).toISOString(),
    http: {
      requests: http.length,
      serverErrors,
      authenticationFailures: http.filter((sample) => sample.status === 401).length,
      rateLimitEvents: http.filter((sample) => sample.status === 429).length,
      errorRate: http.length === 0 ? null : serverErrors / http.length,
      latencyMs: {
        count: durations.length,
        sum: durations.reduce((total, value) => total + value, 0),
        max: durations.length === 0 ? null : Math.max(...durations),
        p95: percentile(durations, 0.95),
      },
    },
    dependencies: { database: databaseState, redis: redisState },
    ai: {
      requests: ai.length,
      failedRequests: ai.filter((sample) => sample.failed).length,
      inputTokens: ai.reduce((total, sample) => total + sample.inputTokens, 0),
      outputTokens: ai.reduce((total, sample) => total + sample.outputTokens, 0),
      estimatedCostUsd: ai.reduce((total, sample) => total + sample.estimatedCostUsd, 0),
      unpricedRequests: ai.filter((sample) => sample.unpriced).length,
    },
    jobs: jobCounts,
  }
}
