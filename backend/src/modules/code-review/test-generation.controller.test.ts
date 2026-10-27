import assert from 'node:assert/strict'
import test from 'node:test'
import type { Request, Response } from 'express'
import { TestGenerationController } from './test-generation.controller'
import type { TestGenerationReviewService } from './test-generation.controller'
import type { TestSuggestionResult } from './test-generator'
import { ReviewNotFoundError } from './review.service'
import { TestGenerationError } from './test-generator'

function responseRecorder() {
  let statusCode = 200
  let body: unknown
  const response = {
    status(code: number) {
      statusCode = code
      return response
    },
    json(value: unknown) {
      body = value
      return response
    },
  }
  return {
    response: response as unknown as Response,
    get statusCode() {
      return statusCode
    },
    get body() {
      return body
    },
  }
}

const ownedReview = {
  fileContent: '--- src/handler.ts ---\nexport function handle(value: string) { return value }',
  findings: [
    {
      id: 'finding-1',
      file: 'src/handler.ts',
      line: 1,
      title: 'Review finding',
      message: 'A finding.',
      evidence: 'return value',
      suggestions: [],
    },
  ],
}

test('requires authentication and keeps suggestion generation scoped to the requesting user', async () => {
  const userIds: string[] = []
  const reviews: TestGenerationReviewService = {
    async getReview(userId) {
      userIds.push(userId)
      return ownedReview
    },
  }
  let providerCalls = 0
  const result: TestSuggestionResult = {
    framework: 'node:test via tsx',
    suggestions: [],
    duplicateCount: 0,
    previewOnly: true,
  }
  const controller = new TestGenerationController(
    reviews,
    async () => {
      providerCalls += 1
      return result
    }
  )

  const unauthorized = responseRecorder()
  await controller.generateForFinding(
    { params: { id: 'review-1', findingId: 'finding-1' } } as unknown as Request,
    unauthorized.response
  )
  assert.equal(unauthorized.statusCode, 401)
  assert.equal(userIds.length, 0)

  const authorized = responseRecorder()
  await controller.generateForFinding(
    {
      user: { userId: 'tenant-user-1' },
      params: { id: 'review-1', findingId: 'finding-1' },
    } as unknown as Request,
    authorized.response
  )
  assert.equal(authorized.statusCode, 200)
  assert.deepEqual(userIds, ['tenant-user-1'])
  assert.equal(providerCalls, 1)
  assert.deepEqual(authorized.body, { result })
})

test('does not generate suggestions for another tenant review or an unrelated finding', async () => {
  let providerCalls = 0
  const reviews: TestGenerationReviewService = {
    async getReview(userId) {
      assert.equal(userId, 'tenant-user-2')
      throw new ReviewNotFoundError()
    },
  }
  const controller = new TestGenerationController(
    reviews,
    async () => {
      providerCalls += 1
      throw new Error('must not run')
    }
  )
  const result = responseRecorder()
  await controller.generateForFinding(
    {
      user: { userId: 'tenant-user-2' },
      params: { id: 'private-review', findingId: 'finding-1' },
    } as unknown as Request,
    result.response
  )

  assert.equal(result.statusCode, 404)
  assert.equal(providerCalls, 0)
  assert.deepEqual(result.body, { error: 'Review or finding not found.' })
})

test('does not disclose a finding outside the authorized review', async () => {
  let providerCalls = 0
  const controller = new TestGenerationController(
    { async getReview() { return ownedReview } },
    async () => {
      providerCalls += 1
      throw new Error('must not run')
    }
  )
  const result = responseRecorder()
  await controller.generateForFinding(
    {
      user: { userId: 'tenant-user-1' },
      params: { id: 'review-1', findingId: 'another-finding' },
    } as unknown as Request,
    result.response
  )

  assert.equal(result.statusCode, 404)
  assert.equal(providerCalls, 0)
})

test('returns explicit timeout and unsupported-language responses', async () => {
  const reviews: TestGenerationReviewService = {
    async getReview() { return ownedReview },
  }
  const timeoutController = new TestGenerationController(
    reviews,
    async () => { throw new TestGenerationError('timeout') }
  )
  const timeoutResponse = responseRecorder()
  await timeoutController.generateForFinding(
    {
      user: { userId: 'tenant-user-1' },
      params: { id: 'review-1', findingId: 'finding-1' },
    } as unknown as Request,
    timeoutResponse.response
  )
  assert.equal(timeoutResponse.statusCode, 504)

  const unsupportedController = new TestGenerationController(
    reviews,
    async () => { throw new TestGenerationError('unsupported_language') }
  )
  const unsupportedResponse = responseRecorder()
  await unsupportedController.generateForFinding(
    {
      user: { userId: 'tenant-user-1' },
      params: { id: 'review-1', findingId: 'finding-1' },
    } as unknown as Request,
    unsupportedResponse.response
  )
  assert.equal(unsupportedResponse.statusCode, 400)
})
