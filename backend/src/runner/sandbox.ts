import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface SandboxLimits {
  cpus: string
  memory: string
  pidsLimit: number
  timeoutMs: number
  workspaceBytes: number
  diskTmpfs: string
}

export interface SandboxPlan {
  command: string[]
  refusedHooks: string[]
  dockerArgs: string[]
  executionTrustsRepositoryScripts: false
}

export interface SandboxExecutionOutput {
  executionOccurred: boolean
  timedOut: boolean
  exitCode: number | null
  durationMs: number
  logs: string
  command: string
}

const LIFECYCLE_HOOKS = [
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublish',
  'pretest',
  'test',
  'posttest',
  'prestart',
  'start',
]

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.internal',
])

export function assertPublicGitTarget(
  repositoryUrl: string,
  commitSha: string,
  allowedHosts: string[]
): void {
  let url: URL
  try {
    url = new URL(repositoryUrl)
  } catch {
    throw new Error('Repository URL is not allowed.')
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !allowedHosts.map((item) => item.toLowerCase()).includes(host) ||
    BLOCKED_HOSTS.has(host) ||
    isPrivateAddress(host) ||
    !/^[0-9a-f]{40}$/.test(commitSha)
  ) {
    throw new Error('Repository URL is not allowed.')
  }
}

function isPrivateAddress(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  const octets = match.slice(1).map((part) => Number(part))
  if (octets.some((part) => part > 255)) return true
  const [first, second] = octets
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    first === 0
  )
}

export function refusedRepositoryInstructions(patch: string): string[] {
  const added = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n')
    .toLowerCase()
  return LIFECYCLE_HOOKS.filter((hook) => added.includes(`"${hook}"`) || added.includes(`${hook}:`))
}

export function buildDockerRunArguments(input: {
  image: string
  workspaceDir: string
  containerName: string
  command: string[]
  limits: SandboxLimits
}): string[] {
  if (input.command.some((part) => part.includes('docker.sock') || part === 'npm' || part === 'yarn')) {
    throw new Error('Sandbox command is not allowed.')
  }
  const args = [
    'run',
    '--rm',
    '--name',
    input.containerName,
    '--network',
    'none',
    '--user',
    '65532:65532',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    String(input.limits.pidsLimit),
    '--memory',
    input.limits.memory,
    '--memory-swap',
    input.limits.memory,
    '--cpus',
    input.limits.cpus,
    '--read-only',
    '--tmpfs',
    `/tmp:rw,noexec,nosuid,size=${input.limits.diskTmpfs}`,
    '--mount',
    `type=bind,src=${input.workspaceDir},dst=/workspace`,
    '--workdir',
    '/workspace',
    '-e',
    'npm_config_ignore_scripts=true',
    '-e',
    'HOME=/tmp',
    '--',
    input.image,
    ...input.command,
  ]
  const rendered = args.join(' ')
  if (
    rendered.includes('docker.sock') ||
    rendered.includes('--privileged') ||
    rendered.includes('--network host') ||
    rendered.includes('--user root') ||
    rendered.includes('--user 0:')
  ) {
    throw new Error('Sandbox arguments are not allowed.')
  }
  return args
}

export function planSandboxExecution(input: {
  patch: string
  image: string
  workspaceDir: string
  containerName: string
  limits: SandboxLimits
}): SandboxPlan {
  const command = ['node', '--test']
  return {
    command,
    refusedHooks: refusedRepositoryInstructions(input.patch),
    executionTrustsRepositoryScripts: false,
    dockerArgs: buildDockerRunArguments({ ...input, command }),
  }
}

export function createDisabledSandboxExecutor(): {
  execute(): Promise<SandboxExecutionOutput>
} {
  return {
    async execute() {
      return {
        executionOccurred: false,
        timedOut: false,
        exitCode: null,
        durationMs: 0,
        logs: 'Sandbox execution is disabled. Repository code was not executed.',
        command: 'node --test',
      }
    },
  }
}

export async function executeDockerSandbox(input: {
  image: string
  workspaceDir: string
  containerName: string
  command: string[]
  limits: SandboxLimits
  spawnImpl?: typeof spawn
}): Promise<SandboxExecutionOutput> {
  const args = buildDockerRunArguments(input)
  const started = Date.now()
  const child = (input.spawnImpl ?? spawn)('docker', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { PATH: process.env.PATH ?? '' },
  })
  let logs = ''
  const append = (chunk: Buffer) => {
    if (logs.length < 16_000) logs += chunk.toString('utf8')
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  const timeout = setTimeout(() => {
    child.kill()
    ;(input.spawnImpl ?? spawn)('docker', ['rm', '-f', input.containerName], {
      stdio: 'ignore',
      windowsHide: true,
    })
  }, input.limits.timeoutMs)
  const exitCode = await new Promise<number | null>((resolveExit) => {
    child.once('error', () => resolveExit(null))
    child.once('close', (code) => resolveExit(code))
  })
  clearTimeout(timeout)
  const durationMs = Date.now() - started
  const timedOut = durationMs >= input.limits.timeoutMs && exitCode === null
  return {
    executionOccurred: exitCode !== null,
    timedOut,
    exitCode,
    durationMs,
    logs,
    command: input.command.join(' '),
  }
}

export async function withDisposableWorkspace<T>(
  work: (directory: string) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'codeguard-verify-'))
  try {
    return await work(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function workspaceExceedsLimit(directory: string, maxBytes: number): Promise<boolean> {
  const pending = [directory]
  let total = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = join(current, entry.name)
      if (entry.isSymbolicLink()) return true
      if (entry.isDirectory()) {
        pending.push(entryPath)
        continue
      }
      total += (await stat(entryPath)).size
      if (total > maxBytes) return true
    }
  }
  return false
}
