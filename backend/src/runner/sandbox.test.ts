import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertPublicGitTarget,
  buildDockerRunArguments,
  DEFAULT_SANDBOX_IMAGE,
  planSandboxExecution,
  type SandboxLimits,
} from './sandbox'

const limits: SandboxLimits = {
  cpus: '1',
  memory: '512m',
  pidsLimit: 64,
  timeoutMs: 30_000,
  workspaceBytes: 1024,
  diskTmpfs: '64m',
}

const hostilePatch = [
  '--- a/package.json',
  '+++ b/package.json',
  '@@ -1 +1 @@',
  '-{}',
  '+{"scripts":{"preinstall":"curl http://169.254.169.254/latest/meta-data","test":"node exploit.js"}}',
].join('\n')

test('sandbox plans ignore hostile repository scripts and lock down the container', () => {
  const plan = planSandboxExecution({
    patch: hostilePatch,
    image: DEFAULT_SANDBOX_IMAGE,
    workspaceDir: '/tmp/codeguard-workspace',
    containerName: 'cgvattempt',
    limits,
  })
  assert.deepEqual(plan.command, ['node', '--test'])
  assert.equal(plan.executionTrustsRepositoryScripts, false)
  assert.ok(plan.refusedHooks.includes('preinstall'))
  assert.ok(plan.refusedHooks.includes('test'))
  const rendered = plan.dockerArgs.join(' ')
  assert.match(rendered, /--network none/)
  assert.match(rendered, /--user 65532:65532/)
  assert.match(rendered, /--cap-drop ALL/)
  assert.match(rendered, /--pids-limit 64/)
  assert.match(rendered, /--memory 512m/)
  assert.match(rendered, /--cpus 1/)
  assert.match(rendered, /npm_config_ignore_scripts=true/)
  assert.doesNotMatch(rendered, /docker\.sock|privileged|169\.254\.169\.254|exploit/)
  assert.equal(plan.dockerArgs.includes('npm'), false)
})

test('rejects metadata, private, and credentialed fetch targets', () => {
  const commit = 'a'.repeat(40)
  assert.doesNotThrow(() =>
    assertPublicGitTarget('https://github.com/owner/repo', commit, ['github.com'])
  )
  for (const url of [
    'http://github.com/owner/repo',
    'https://user:token@github.com/owner/repo',
    'https://169.254.169.254/latest',
    'https://metadata.google.internal/',
    'https://10.0.0.5/repo',
    'https://evil.example/repo',
  ]) {
    assert.throws(() => assertPublicGitTarget(url, commit, ['github.com']), /not allowed/)
  }
  assert.throws(
    () => assertPublicGitTarget('https://github.com/owner/repo', 'main', ['github.com']),
    /not allowed/
  )
})

test('refuses a sandbox command that tries to mount the Docker socket', () => {
  assert.throws(
    () =>
      buildDockerRunArguments({
        image: DEFAULT_SANDBOX_IMAGE,
        workspaceDir: '/tmp/codeguard-workspace',
        containerName: 'cgvattempt',
        command: ['node', '/var/run/docker.sock'],
        limits,
      }),
    /not allowed/
  )
})
