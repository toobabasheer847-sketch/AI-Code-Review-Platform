import assert from 'node:assert/strict'
import test from 'node:test'
import {
  integrationOptIn,
  readGitHubIntegrationTarget,
} from '@/testing/provider-test-env'
import { GitHubIntegrationError, GitHubService } from './github.service'

const optedIn = integrationOptIn('RUN_GITHUB_INTEGRATION_TEST')
const target = optedIn ? readGitHubIntegrationTarget() : undefined
const fakeToken = 'invalid-integration-token-value'

function serviceFor(token: string): GitHubService {
  return new GitHubService(undefined, async () => token)
}

test(
  'rejects an invalid GitHub credential without recording it',
  { skip: optedIn ? false : 'Set RUN_GITHUB_INTEGRATION_TEST=1 to call GitHub with a fake credential.' },
  async () => {
    const service = serviceFor(fakeToken)
    await assert.rejects(
      () => service.validateDevelopmentRepository('integration-user', 'octocat/Hello-World'),
      (error: unknown) => {
        assert.ok(error instanceof GitHubIntegrationError)
        assert.equal(error.statusCode, 401)
        assert.equal(error.message, 'GitHub authorization was revoked or expired.')
        assert.equal(JSON.stringify(error).includes(fakeToken), false)
        return true
      }
    )
  }
)

test(
  'authenticates and reads only the dedicated test repository',
  { skip: target ? false : 'Set GITHUB_INTEGRATION_TOKEN, GITHUB_INTEGRATION_OWNER, and GITHUB_INTEGRATION_REPO.' },
  async () => {
    assert.ok(target)
    const service = serviceFor(target.token)
    const profile = await service.fetchGitHubProfile(target.token)
    assert.equal(typeof profile.login, 'string')
    assert.equal(profile.login.length > 0, true)
    assert.equal(JSON.stringify(profile).includes(target.token), false)
    const repository = await service.validateDevelopmentRepository(
      'integration-user',
      `${target.owner}/${target.repo}`
    )
    assert.equal(repository.fullName.toLowerCase(), `${target.owner}/${target.repo}`.toLowerCase())
    await assert.rejects(
      () =>
        service.validateDevelopmentRepository(
          'integration-user',
          `${target.owner}/missing-integration-repository`
        ),
      (error: unknown) => {
        assert.ok(error instanceof GitHubIntegrationError)
        assert.equal(error.statusCode, 404)
        assert.equal(error.message.includes(target.token), false)
        return true
      }
    )
  }
)
