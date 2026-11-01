import { spawn } from 'node:child_process'
import { assertPublicGitTarget } from './sandbox'

async function runGit(
  args: string[],
  options: { cwd?: string; input?: string; timeoutMs: number; spawnImpl?: typeof spawn }
): Promise<void> {
  const child = (options.spawnImpl ?? spawn)(args[0], args.slice(1), {
    cwd: options.cwd,
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
    env: { PATH: process.env.PATH ?? '', GIT_TERMINAL_PROMPT: '0' },
  })
  if (options.input) child.stdin?.end(options.input)
  else child.stdin?.end()
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderr.length < 500) stderr += chunk.toString('utf8')
  })
  const timer = setTimeout(() => child.kill(), options.timeoutMs)
  const code = await new Promise<number | null>((resolveExit) => {
    child.once('error', () => resolveExit(null))
    child.once('close', (exitCode) => resolveExit(exitCode))
  })
  clearTimeout(timer)
  if (code !== 0) throw new Error('Repository checkout failed.')
}

export async function prepareVerifiedCheckout(input: {
  repositoryUrl: string
  commitSha: string
  patch: string
  directory: string
  allowedHosts: string[]
  timeoutMs: number
  spawnImpl?: typeof spawn
}): Promise<void> {
  assertPublicGitTarget(input.repositoryUrl, input.commitSha, input.allowedHosts)
  const git = [
    'git',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'credential.helper=',
    '-c',
    'protocol.file.allow=never',
  ]
  await runGit(
    [...git, 'clone', '--depth', '1', '--no-tags', '--no-checkout', input.repositoryUrl, input.directory],
    { timeoutMs: input.timeoutMs, spawnImpl: input.spawnImpl }
  )
  await runGit([...git, '-C', input.directory, 'fetch', '--depth', '1', 'origin', input.commitSha], {
    timeoutMs: input.timeoutMs,
    spawnImpl: input.spawnImpl,
  })
  await runGit([...git, '-C', input.directory, 'checkout', '--detach', input.commitSha], {
    timeoutMs: input.timeoutMs,
    spawnImpl: input.spawnImpl,
  })
  const head = await readHead(input.directory, input.timeoutMs, input.spawnImpl)
  if (head !== input.commitSha) throw new Error('Checked out revision did not match the requested commit.')
  await runGit([...git, '-C', input.directory, 'apply', '--check', '-'], {
    timeoutMs: input.timeoutMs,
    input: input.patch,
    spawnImpl: input.spawnImpl,
  })
  await runGit([...git, '-C', input.directory, 'apply', '-'], {
    timeoutMs: input.timeoutMs,
    input: input.patch,
    spawnImpl: input.spawnImpl,
  })
}

async function readHead(
  directory: string,
  timeoutMs: number,
  spawnImpl?: typeof spawn
): Promise<string> {
  const child = (spawnImpl ?? spawn)(
    'git',
    ['-C', directory, '-c', 'core.hooksPath=/dev/null', 'rev-parse', 'HEAD'],
    { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env: { PATH: process.env.PATH ?? '' } }
  )
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    if (output.length < 80) output += chunk.toString('utf8')
  })
  const timer = setTimeout(() => child.kill(), timeoutMs)
  const code = await new Promise<number | null>((resolveExit) => {
    child.once('error', () => resolveExit(null))
    child.once('close', (exitCode) => resolveExit(exitCode))
  })
  clearTimeout(timer)
  if (code !== 0) throw new Error('Repository checkout failed.')
  return output.trim()
}
