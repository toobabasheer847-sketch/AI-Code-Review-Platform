import assert from 'node:assert/strict'
import { AutomationMode } from '@prisma/client'
import test from 'node:test'
import type { ValidatedPlan } from '@/modules/automation/automation.domain'
import { GitHubDevelopmentService, type GitHubDevelopmentAccess, type GitHubWorkflowCreator } from './github-development.service'
import { InvalidReviewTargetError } from './github.service'

function createHarness(options: { accessError?: Error } = {}) {
  const calls: {
    repositoryValidation: Array<{ userId: string; repository: string; write: boolean }>
    pullRequests: Array<{ userId: string; repository: string; number: number }>
    workflows: Array<{
      userId: string
      goal: string
      mode: string
      idempotencyKey?: string
      plan?: ValidatedPlan
    }>
  } = { repositoryValidation: [], pullRequests: [], workflows: [] }
  const github: GitHubDevelopmentAccess = {
    async validateDevelopmentRepository(userId, repository, requireWriteAccess = false) {
      calls.repositoryValidation.push({ userId, repository, write: requireWriteAccess })
      if (options.accessError) throw options.accessError
      return {
        fullName: 'owner/repository',
        htmlUrl: 'https://github.com/owner/repository',
        private: true,
      }
    },
    async fetchPullRequestTarget(userId, repository, pullRequestNumber) {
      calls.pullRequests.push({ userId, repository, number: pullRequestNumber })
      if (options.accessError) throw options.accessError
      return {}
    },
  }
  const workflows: GitHubWorkflowCreator = {
    async create(userId, input) {
      calls.workflows.push({ userId, ...input })
      return { id: 'automation-1', ...input }
    },
  }
  return {
    calls,
    service: new GitHubDevelopmentService(github, workflows),
  }
}

test('repository brief uses the existing workflow engine and approved allowlisted tasks', async () => {
  const { calls, service } = createHarness()
  await service.createWorkflow('user-a', {
    template: 'repository_brief',
    repository: 'OWNER/REPOSITORY',
    idempotencyKey: 'request-1',
  })
  assert.deepEqual(calls.repositoryValidation, [
    { userId: 'user-a', repository: 'OWNER/REPOSITORY', write: false },
  ])
  assert.equal(calls.workflows.length, 1)
  const workflow = calls.workflows[0]
  assert.equal(workflow?.mode, AutomationMode.APPROVAL_REQUIRED)
  assert.equal(workflow?.idempotencyKey, 'request-1')
  assert.equal(workflow?.plan?.tasks[0]?.action, 'collect_github_context')
  assert.equal(workflow?.plan?.tasks[1]?.action, 'generate_text_draft')
  assert.deepEqual(workflow?.plan?.tasks[1]?.dependsOn, ['github-context'])
})

test('issue creation requires repository write access and binds exact content to approval', async () => {
  const { calls, service } = createHarness()
  await service.createWorkflow('user-a', {
    template: 'prepare_issue',
    repository: 'owner/repository',
    issueTitle: 'Guard request input',
    issueBody: 'Validate the request before use.',
    idempotencyKey: 'request-2',
  })
  assert.deepEqual(calls.repositoryValidation[0], {
    userId: 'user-a',
    repository: 'owner/repository',
    write: true,
  })
  const issueTask = calls.workflows[0]?.plan?.tasks.find(
    (task) => task.action === 'create_github_issue'
  )
  assert.ok(issueTask)
  assert.deepEqual(issueTask.input, {
    repository: 'owner/repository',
    title: 'Guard request input',
    body: 'Validate the request before use.',
  })
})

test('pull request templates verify target access before persisting the workflow', async () => {
  const { calls, service } = createHarness()
  await service.createWorkflow('user-a', {
    template: 'pull_request_investigation',
    repository: 'owner/repository',
    pullRequestNumber: 12,
  })
  assert.deepEqual(calls.pullRequests, [
    { userId: 'user-a', repository: 'owner/repository', number: 12 },
  ])
  assert.equal(calls.workflows[0]?.plan?.tasks[0]?.input instanceof Object, true)
  assert.deepEqual(calls.workflows[0]?.plan?.tasks[0]?.input, {
    repository: 'owner/repository',
    pullRequestNumber: 12,
  })
})

test('unavailable repository access or invalid pull request prevents workflow creation', async () => {
  const denied = createHarness({
    accessError: new Error('Repository access denied'),
  })
  await assert.rejects(
    denied.service.createWorkflow('user-a', {
      template: 'repository_brief',
      repository: 'owner/repository',
    }),
    /Repository access denied/
  )
  assert.equal(denied.calls.workflows.length, 0)

  const invalidPullRequest = createHarness({
    accessError: new InvalidReviewTargetError('Pull request is not accessible'),
  })
  await assert.rejects(
    invalidPullRequest.service.createWorkflow('user-a', {
      template: 'pull_request_investigation',
      repository: 'owner/repository',
      pullRequestNumber: 12,
    }),
    /Pull request is not accessible/
  )
  assert.equal(invalidPullRequest.calls.workflows.length, 0)
})

test('pull request investigation requires a selected pull request', async () => {
  const { calls, service } = createHarness()
  await assert.rejects(
    service.createWorkflow('user-a', {
      template: 'pull_request_investigation',
      repository: 'owner/repository',
    }),
    /pull request number is required/
  )
  assert.equal(calls.workflows.length, 0)
})

