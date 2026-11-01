import { createServer } from 'node:http'
import { prepareVerifiedCheckout } from './checkout'
import { loadRunnerConfig } from './config'
import { createVerificationRunnerApp, type VerificationRunnerExecutor } from './app'
import {
  createDisabledSandboxExecutor,
  executeDockerSandbox,
  withDisposableWorkspace,
  workspaceExceedsLimit,
  type SandboxExecutionOutput,
} from './sandbox'

const config = loadRunnerConfig()

function createProductionExecutor(): VerificationRunnerExecutor {
  if (config.sandboxMode !== 'docker') return createDisabledSandboxExecutor()
  return {
    async execute(input): Promise<SandboxExecutionOutput & { commitVerified?: boolean }> {
      if (!config.allowFetch || !input.commitSha) {
        return {
          executionOccurred: false,
          timedOut: false,
          exitCode: null,
          durationMs: 0,
          logs: 'Commit checkout is disabled. Repository code was not executed.',
          command: input.command.join(' '),
          commitVerified: false,
        }
      }
      return withDisposableWorkspace(async (directory) => {
        try {
          await prepareVerifiedCheckout({
            repositoryUrl: input.repositoryUrl,
            commitSha: input.commitSha ?? '',
            patch: input.patch,
            directory,
            allowedHosts: config.allowedGitHosts,
            timeoutMs: config.limits.timeoutMs,
          })
          if (await workspaceExceedsLimit(directory, config.limits.workspaceBytes)) {
            return {
              executionOccurred: false,
              timedOut: false,
              exitCode: null,
              durationMs: 0,
              logs: 'The checkout exceeded the workspace disk limit and was deleted.',
              command: input.command.join(' '),
              commitVerified: false,
            }
          }
          const output = await executeDockerSandbox({
            image: config.image,
            workspaceDir: directory,
            containerName: `cgv${input.attemptId.replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}`,
            command: input.command,
            limits: config.limits,
          })
          return { ...output, commitVerified: output.executionOccurred }
        } catch {
          return {
            executionOccurred: false,
            timedOut: false,
            exitCode: null,
            durationMs: 0,
            logs: 'The repository checkout failed. Repository code was not executed.',
            command: input.command.join(' '),
            commitVerified: false,
          }
        }
      })
    },
  }
}

if (!config.token || config.token.length < 32) {
  throw new Error('FIX_VERIFICATION_RUNNER_TOKEN must be at least 32 characters.')
}

const runner = createVerificationRunnerApp({
  token: config.token,
  identity: config.identity,
  version: config.version,
  executor: createProductionExecutor(),
  limits: config.limits,
  image: config.image,
  ...(config.callbackUrl ? { callbackUrl: config.callbackUrl } : {}),
})

const server = createServer(runner.app)
server.listen(config.port, '0.0.0.0')
