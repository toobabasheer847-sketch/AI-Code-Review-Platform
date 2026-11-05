import { DEFAULT_SANDBOX_IMAGE } from './sandbox'

export interface VerificationRunnerConfig {
  port: number
  token: string
  identity: string
  version: string
  sandboxMode: 'disabled' | 'docker'
  allowFetch: boolean
  image: string
  callbackUrl: string
  allowedGitHosts: string[]
  limits: {
    cpus: string
    memory: string
    pidsLimit: number
    timeoutMs: number
    workspaceBytes: number
    diskTmpfs: string
  }
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value ? Number(value) : fallback
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}

export function loadRunnerConfig(
  environment: NodeJS.ProcessEnv = process.env
): VerificationRunnerConfig {
  const sandboxMode = environment.VERIFICATION_SANDBOX_MODE === 'docker' ? 'docker' : 'disabled'
  return {
    port: integer(environment.VERIFICATION_RUNNER_PORT, 8080, 1, 65535),
    token: environment.FIX_VERIFICATION_RUNNER_TOKEN ?? '',
    identity: (environment.VERIFICATION_RUNNER_IDENTITY ?? 'ai-codeguard-runner').slice(0, 128),
    version: (environment.VERIFICATION_RUNNER_VERSION ?? '1').slice(0, 64),
    sandboxMode,
    allowFetch: environment.VERIFICATION_ALLOW_FETCH === 'true',
    image: environment.VERIFICATION_SANDBOX_IMAGE?.trim() || DEFAULT_SANDBOX_IMAGE,
    callbackUrl: environment.VERIFICATION_CALLBACK_URL?.trim() ?? '',
    allowedGitHosts: (environment.VERIFICATION_ALLOWED_GIT_HOSTS ?? 'github.com')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    limits: {
      cpus: environment.VERIFICATION_SANDBOX_CPUS?.trim() || '1',
      memory: environment.VERIFICATION_SANDBOX_MEMORY?.trim() || '512m',
      pidsLimit: integer(environment.VERIFICATION_SANDBOX_PIDS, 64, 8, 256),
      timeoutMs: integer(environment.VERIFICATION_SANDBOX_TIMEOUT_MS, 300_000, 1_000, 900_000),
      workspaceBytes: integer(
        environment.VERIFICATION_SANDBOX_WORKSPACE_BYTES,
        256 * 1024 * 1024,
        1_048_576,
        1024 * 1024 * 1024
      ),
      diskTmpfs: environment.VERIFICATION_SANDBOX_TMPFS?.trim() || '64m',
    },
  }
}
