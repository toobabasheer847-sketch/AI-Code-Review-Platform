import express, { type Express, type Request } from 'express'
import { z } from 'zod'
import {
  hashFixPatch,
  sanitizeVerificationLogs,
  type VerificationExecutionResult,
} from '@/modules/code-review/fix-verification.domain'
import {
  bearerTokenMatches,
  signVerificationPayload,
  verifyVerificationSignature,
} from '@/modules/code-review/fix-verification.signature'
import { planSandboxExecution, type SandboxExecutionOutput, type SandboxLimits } from './sandbox'

const requestSchema = z
  .object({
    protocolVersion: z.literal(1),
    attemptId: z.string().min(1).max(128),
    patch: z.string().min(1).max(100_000),
    patchSha256: z.string().regex(/^[a-f0-9]{64}$/),
    repository: z
      .object({
        name: z.string().min(1).max(300),
        url: z.string().url().max(2_000),
        branch: z.string().min(1).max(255),
        pullRequestNumber: z.number().int().positive().nullable(),
        commitSha: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
      })
      .strict(),
    finding: z
      .object({
        id: z.string().min(1).max(128),
        title: z.string().max(500),
        severity: z.string().max(32),
        file: z.string().max(500),
      })
      .strict(),
    changedFiles: z.array(z.string().max(500)).max(100),
  })
  .strict()

export interface RunnerExecutorInput {
  attemptId: string
  patch: string
  command: string[]
  repositoryUrl: string
  commitSha: string | null
}

export interface VerificationRunnerExecutor {
  execute(input: RunnerExecutorInput): Promise<SandboxExecutionOutput & { commitVerified?: boolean }>
}

interface StoredRun {
  attemptId: string
  runId: string
  state: 'RUNNING' | 'COMPLETED'
  result: VerificationExecutionResult | null
}

export interface VerificationRunnerApp {
  app: Express
  runs: Map<string, StoredRun>
  whenSettled(): Promise<void>
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function testsActuallyPassed(output: SandboxExecutionOutput): boolean {
  if (!output.executionOccurred || output.timedOut || output.exitCode !== 0) return false
  return /# (?:pass|tests) [1-9]/i.test(output.logs)
}

export function createVerificationRunnerApp(options: {
  token: string
  identity: string
  version: string
  executor: VerificationRunnerExecutor
  limits: SandboxLimits
  image?: string
  callbackUrl?: string
  fetchImpl?: typeof fetch
  now?: () => number
}): VerificationRunnerApp {
  const runs = new Map<string, StoredRun>()
  const pending = new Set<Promise<void>>()
  const app = express()
  app.disable('x-powered-by')
  app.use(
    express.json({
      limit: '150kb',
      verify: (request, _response, buffer) => {
        ;(request as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer)
      },
    })
  )

  function authorized(request: Request, body: string): boolean {
    const timestamp = headerValue(request.headers['x-codeguard-timestamp'])
    const signature = headerValue(request.headers['x-codeguard-signature'])
    return (
      bearerTokenMatches(options.token, headerValue(request.headers.authorization)) &&
      verifyVerificationSignature({
        secret: options.token,
        timestamp,
        signature,
        body,
        now: options.now?.(),
      })
    )
  }

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.get('/v1/verification-runs/:attemptId', (request, response) => {
    if (!authorized(request, '')) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    const run = runs.get(request.params.attemptId)
    if (!run) {
      response.status(404).json({ error: 'Not found' })
      return
    }
    if (run.state === 'RUNNING' || !run.result) {
      response.json({
        status: 'RUNNING',
        attemptId: run.attemptId,
        runId: run.runId,
        executionOccurred: false,
      })
      return
    }
    response.json(run.result)
  })

  app.post('/v1/verification-runs', (request, response) => {
    const rawBody = (request as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? ''
    if (!authorized(request, rawBody)) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    const parsed = requestSchema.safeParse(request.body)
    if (!parsed.success || hashFixPatch(parsed.data.patch) !== parsed.data.patchSha256) {
      response.status(422).json({ error: 'Invalid verification request.' })
      return
    }
    const existing = runs.get(parsed.data.attemptId)
    if (existing) {
      response.status(existing.state === 'COMPLETED' && existing.result ? 200 : 202).json(
        existing.result ?? {
          accepted: true,
          attemptId: existing.attemptId,
          runId: existing.runId,
          executionOccurred: false,
        }
      )
      return
    }
    const plan = planSandboxExecution({
      patch: parsed.data.patch,
      image: options.image ?? 'node:20-alpine',
      workspaceDir: '/workspace',
      containerName: `cgv${parsed.data.attemptId.replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}`,
      limits: options.limits,
    })
    const runId = parsed.data.attemptId
    const startedAt = new Date(options.now?.() ?? Date.now()).toISOString()
    runs.set(parsed.data.attemptId, {
      attemptId: parsed.data.attemptId,
      runId,
      state: 'RUNNING',
      result: null,
    })
    const task = options.executor
      .execute({
        attemptId: parsed.data.attemptId,
        patch: parsed.data.patch,
        command: plan.command,
        repositoryUrl: parsed.data.repository.url,
        commitSha: parsed.data.repository.commitSha,
      })
      .then(async (output) => {
        const result = toResult({
          request: parsed.data,
          output,
          command: plan.command,
          identity: options.identity,
          version: options.version,
          startedAt,
          completedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
        })
        runs.set(parsed.data.attemptId, {
          attemptId: parsed.data.attemptId,
          runId,
          state: 'COMPLETED',
          result,
        })
        try {
          await deliverCallback(options, result)
        } catch {
          // The result stays available to the API poll if the callback is rejected.
        }
      })
      .catch(() => {
        const result = toResult({
          request: parsed.data,
          output: {
            executionOccurred: false,
            timedOut: false,
            exitCode: null,
            durationMs: 0,
            logs: 'The sandbox failed before repository code could be executed.',
            command: plan.command.join(' '),
          },
          command: plan.command,
          identity: options.identity,
          version: options.version,
          startedAt,
          completedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
        })
        runs.set(parsed.data.attemptId, {
          attemptId: parsed.data.attemptId,
          runId,
          state: 'COMPLETED',
          result,
        })
      })
    let tracked: Promise<void> = Promise.resolve()
    tracked = task.finally(() => {
      pending.delete(tracked)
    })
    pending.add(tracked)
    response.status(202).json({
      accepted: true,
      attemptId: parsed.data.attemptId,
      runId,
      executionOccurred: false,
    })
  })

  return {
    app,
    runs,
    async whenSettled() {
      while (pending.size > 0) await Promise.all([...pending])
    },
  }
}

function toResult(input: {
  request: z.infer<typeof requestSchema>
  output: SandboxExecutionOutput & { commitVerified?: boolean }
  command: string[]
  identity: string
  version: string
  startedAt: string
  completedAt: string
}): VerificationExecutionResult {
  const logs = sanitizeVerificationLogs(input.output.logs)
  const passed = testsActuallyPassed(input.output)
  const command = input.command.join(' ')
  const executed = input.output.executionOccurred
  return {
    attemptId: input.request.attemptId,
    patchSha256: input.request.patchSha256,
    commitSha: input.output.commitVerified ? input.request.repository.commitSha : null,
    executionStatus: input.output.timedOut ? 'TIMED_OUT' : executed ? (input.output.exitCode === 0 ? 'SUCCEEDED' : 'FAILED') : 'FAILED',
    testCommands: executed ? [command] : [],
    testsPassed: passed,
    originalIssueReproducedBefore: null,
    originalIssueReproducedAfter: null,
    sanitizedLogs: logs,
    checkResults: executed
      ? [
          {
            name: 'TEST',
            command,
            status: input.output.timedOut ? 'TIMED_OUT' : passed ? 'PASSED' : input.output.exitCode === 0 ? 'NOT_RUN' : 'FAILED',
            exitCode: input.output.exitCode,
            durationMs: input.output.durationMs,
            failureDetails: passed ? null : 'The sandbox did not produce a passing test result.',
            logs,
          },
        ]
      : [],
    durationMs: input.output.durationMs,
    exitCode: input.output.exitCode,
    failureDetails: executed ? null : 'Repository code was not executed.',
    executionOccurred: executed,
    runnerIdentity: input.identity,
    runnerVersion: input.version,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  }
}

async function deliverCallback(
  options: { token: string; callbackUrl?: string; fetchImpl?: typeof fetch; now?: () => number },
  result: VerificationExecutionResult
): Promise<void> {
  if (!options.callbackUrl) return
  const body = JSON.stringify(result)
  const timestamp = String(options.now?.() ?? Date.now())
  const response = await (options.fetchImpl ?? fetch)(options.callbackUrl, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token}`,
      'X-CodeGuard-Timestamp': timestamp,
      'X-CodeGuard-Signature': signVerificationPayload(options.token, timestamp, body),
    },
    body,
  })
  if (!response.ok) throw new Error('callback rejected')
}
