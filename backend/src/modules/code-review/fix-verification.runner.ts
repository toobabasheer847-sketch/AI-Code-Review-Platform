import axios, { type AxiosRequestConfig } from 'axios'
import { z } from 'zod'
import { env } from '@/config/env'
import {
  verificationExecutionResultSchema,
  type VerificationExecutionResult,
} from './fix-verification.domain'
import { signVerificationPayload } from './fix-verification.signature'
import type { VerificationDispatchRunner } from './fix-verification.lifecycle'
import type { TrustedVerificationRunner } from './fix-verification.service'

const MAX_RUNNER_RESPONSE_BYTES = 128_000
const MAX_RUNNER_REQUEST_BYTES = 150_000

export interface VerificationRunnerRequest {
  protocolVersion: 1
  attemptId: string
  patch: string
  patchSha256: string
  repository: {
    name: string
    url: string
    branch: string
    pullRequestNumber: number | null
    commitSha: string | null
  }
  finding: {
    id: string
    title: string
    severity: string
    file: string
  }
  changedFiles: string[]
}

const acceptedRunnerSchema = z
  .object({
    accepted: z.literal(true),
    attemptId: z.string().min(1).max(128),
    runId: z.string().min(1).max(128),
    executionOccurred: z.literal(false),
  })
  .strict()

const pendingRunnerSchema = z
  .object({
    status: z.literal('RUNNING'),
    attemptId: z.string().min(1).max(128),
    runId: z.string().min(1).max(128),
    executionOccurred: z.literal(false),
  })
  .strict()

export interface VerificationRunnerHttpClient {
  post(
    url: string,
    data: VerificationRunnerRequest,
    config: AxiosRequestConfig
  ): Promise<{ data: unknown; status?: number }>
  get?(
    url: string,
    config: AxiosRequestConfig
  ): Promise<{ data: unknown; status?: number }>
}

export class VerificationRunnerTimeoutError extends Error {
  constructor() {
    super('The isolated verification runner timed out.')
    this.name = 'VerificationRunnerTimeoutError'
  }
}

export class VerificationRunnerUnavailableError extends Error {
  constructor() {
    super('The isolated verification runner did not return valid evidence.')
    this.name = 'VerificationRunnerUnavailableError'
  }
}

export class RemoteFixVerificationRunner
  implements TrustedVerificationRunner, VerificationDispatchRunner
{
  private readonly endpoint: string

  constructor(
    private readonly token: string,
    private readonly timeoutMs: number,
    runnerUrl: string,
    private readonly client: VerificationRunnerHttpClient = {
      post: (url, data, config) => axios.post(url, data, config),
      get: (url, config) => axios.get(url, config),
    }
  ) {
    const baseUrl = new URL(runnerUrl)
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/`
    this.endpoint = new URL('v1/verification-runs', baseUrl).toString()
  }

  async execute(
    input: Parameters<TrustedVerificationRunner['execute']>[0] & { attemptId: string }
  ): Promise<VerificationExecutionResult> {
    const response = await this.post(input)
    const parsed = verificationExecutionResultSchema.safeParse(response.data)
    if (!parsed.success) throw new VerificationRunnerUnavailableError()
    return parsed.data
  }

  async dispatch(
    input: Parameters<VerificationDispatchRunner['dispatch']>[0]
  ): Promise<Awaited<ReturnType<VerificationDispatchRunner['dispatch']>>> {
    const response = await this.post(input)
    if (response.status === 202 || acceptedRunnerSchema.safeParse(response.data).success) {
      const accepted = acceptedRunnerSchema.safeParse(response.data)
      if (!accepted.success || accepted.data.attemptId !== input.attemptId) {
        throw new VerificationRunnerUnavailableError()
      }
      return { kind: 'accepted', runId: accepted.data.runId }
    }
    const parsed = verificationExecutionResultSchema.safeParse(response.data)
    if (!parsed.success) throw new VerificationRunnerUnavailableError()
    return { kind: 'completed', result: parsed.data }
  }

  async poll(attemptId: string): Promise<Awaited<ReturnType<VerificationDispatchRunner['poll']>>> {
    if (!this.client.get) throw new VerificationRunnerUnavailableError()
    const timestamp = Date.now().toString()
    try {
      const response = await this.client.get(`${this.endpoint}/${encodeURIComponent(attemptId)}`, {
        timeout: this.timeoutMs,
        maxContentLength: MAX_RUNNER_RESPONSE_BYTES,
        maxRedirects: 0,
        headers: this.signedHeaders(timestamp, '', attemptId),
      })
      if (response.status === 404) return { kind: 'missing' }
      if (pendingRunnerSchema.safeParse(response.data).success) return { kind: 'pending' }
      const parsed = verificationExecutionResultSchema.safeParse(response.data)
      if (!parsed.success || parsed.data.attemptId !== attemptId) {
        throw new VerificationRunnerUnavailableError()
      }
      return { kind: 'completed', result: parsed.data }
    } catch (error) {
      if (error instanceof VerificationRunnerUnavailableError) throw error
      this.rethrowTransport(error)
    }
  }

  private async post(
    input: Parameters<TrustedVerificationRunner['execute']>[0] & { attemptId: string }
  ): Promise<{ data: unknown; status?: number }> {
    const request: VerificationRunnerRequest = {
      protocolVersion: 1,
      attemptId: input.attemptId,
      patch: input.patch,
      patchSha256: input.patchSha256,
      repository: input.repository,
      finding: input.finding,
      changedFiles: input.changedFiles,
    }
    const body = JSON.stringify(request)
    const timestamp = Date.now().toString()
    try {
      return await this.client.post(this.endpoint, request, {
        timeout: this.timeoutMs,
        maxBodyLength: MAX_RUNNER_REQUEST_BYTES,
        maxContentLength: MAX_RUNNER_RESPONSE_BYTES,
        maxRedirects: 0,
        headers: this.signedHeaders(timestamp, body, input.attemptId),
      })
    } catch (error) {
      this.rethrowTransport(error)
    }
  }

  private signedHeaders(timestamp: string, body: string, attemptId: string): Record<string, string> {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': attemptId,
      'X-CodeGuard-Timestamp': timestamp,
      'X-CodeGuard-Signature': signVerificationPayload(this.token, timestamp, body),
    }
  }

  private rethrowTransport(error: unknown): never {
    if (error instanceof VerificationRunnerUnavailableError) throw error
    if (
      axios.isAxiosError(error) &&
      (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
    ) {
      throw new VerificationRunnerTimeoutError()
    }
    throw new VerificationRunnerUnavailableError()
  }
}

export function getConfiguredFixVerificationRunner(): RemoteFixVerificationRunner | null {
  if (!env.FIX_VERIFICATION_RUNNER_URL || !env.FIX_VERIFICATION_RUNNER_TOKEN) return null
  return new RemoteFixVerificationRunner(
    env.FIX_VERIFICATION_RUNNER_TOKEN,
    env.FIX_VERIFICATION_RUNNER_TIMEOUT_MS,
    env.FIX_VERIFICATION_RUNNER_URL
  )
}
