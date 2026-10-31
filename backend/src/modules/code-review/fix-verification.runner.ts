import axios, { type AxiosRequestConfig } from 'axios'
import { env } from '@/config/env'
import {
  verificationExecutionResultSchema,
  type VerificationExecutionResult,
} from './fix-verification.domain'
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

export interface VerificationRunnerHttpClient {
  post(
    url: string,
    data: VerificationRunnerRequest,
    config: AxiosRequestConfig
  ): Promise<{ data: unknown }>
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

export class RemoteFixVerificationRunner implements TrustedVerificationRunner {
  private readonly endpoint: string

  constructor(
    private readonly token: string,
    private readonly timeoutMs: number,
    runnerUrl: string,
    private readonly client: VerificationRunnerHttpClient = {
      post: (url, data, config) => axios.post(url, data, config),
    }
  ) {
    const baseUrl = new URL(runnerUrl)
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/`
    this.endpoint = new URL('v1/verification-runs', baseUrl).toString()
  }

  async execute(
    input: Parameters<TrustedVerificationRunner['execute']>[0] & { attemptId: string }
  ): Promise<VerificationExecutionResult> {
    const request: VerificationRunnerRequest = {
      protocolVersion: 1,
      attemptId: input.attemptId,
      patch: input.patch,
      patchSha256: input.patchSha256,
      repository: input.repository,
      finding: input.finding,
      changedFiles: input.changedFiles,
    }
    try {
      const response = await this.client.post(this.endpoint, request, {
        timeout: this.timeoutMs,
        maxBodyLength: MAX_RUNNER_REQUEST_BYTES,
        maxContentLength: MAX_RUNNER_RESPONSE_BYTES,
        maxRedirects: 0,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': input.attemptId,
        },
      })
      const parsed = verificationExecutionResultSchema.safeParse(response.data)
      if (!parsed.success) throw new VerificationRunnerUnavailableError()
      return parsed.data
    } catch (error) {
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
}

export function getConfiguredFixVerificationRunner(): RemoteFixVerificationRunner | null {
  if (!env.FIX_VERIFICATION_RUNNER_URL || !env.FIX_VERIFICATION_RUNNER_TOKEN) return null
  return new RemoteFixVerificationRunner(
    env.FIX_VERIFICATION_RUNNER_TOKEN,
    env.FIX_VERIFICATION_RUNNER_TIMEOUT_MS,
    env.FIX_VERIFICATION_RUNNER_URL
  )
}
