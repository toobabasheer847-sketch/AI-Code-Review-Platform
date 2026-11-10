import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import test from 'node:test'

import { env } from '@/config/env'
import { createAuthMiddleware } from '@/middleware/auth.middleware'
import { generateToken } from '@/utils/jwt'

import type { BetaStatus } from './beta.domain'
import { createBetaRouter } from './beta.routes'
import {
  BetaService,
  type BetaStore,
  type BetaUserRecord,
  type ProductFeedbackRecord,
} from './beta.service'
import { setProductEventWriter, useDefaultProductEventWriter } from './product-events'

interface Account {
  email: string
  betaStatus: BetaStatus
  isVerified: boolean
  tokenVersion: number
}

function memoryStore(): { store: BetaStore; feedback: ProductFeedbackRecord[] } {
  const feedback: ProductFeedbackRecord[] = []
  const users = new Map<string, BetaUserRecord>([
    ['user-active', { id: 'user-active', email: 'active@example.com', fullName: 'Active User', betaStatus: 'ACTIVE', createdAt: new Date('2026-11-01T00:00:00Z') }],
    ['user-other', { id: 'user-other', email: 'other@example.com', fullName: 'Other User', betaStatus: 'ACTIVE', createdAt: new Date('2026-11-02T00:00:00Z') }],
    ['user-admin', { id: 'user-admin', email: 'admin@example.com', fullName: 'Beta Admin', betaStatus: 'ACTIVE', createdAt: new Date('2026-11-03T00:00:00Z') }],
  ])
  const reviews = new Set(['user-active:review_12345678'])
  let dismissed = false
  const store: BetaStore = {
    async createFeedback(input) {
      const record: ProductFeedbackRecord = {
        ...input,
        id: `feedback-${feedback.length + 1}`,
        status: 'OPEN',
        createdAt: new Date('2026-11-10T00:00:00Z'),
        updatedAt: new Date('2026-11-10T00:00:00Z'),
      }
      feedback.push(record)
      return record
    },
    async listFeedback(userId, category) {
      return feedback.filter((item) => (userId ? item.userId === userId : true) && (category ? item.category === category : true))
    },
    async updateFeedbackStatus(id, status) {
      const record = feedback.find((item) => item.id === id)
      if (!record) return null
      record.status = status
      return record
    },
    async userOwnsReview(userId, reviewId) {
      return reviews.has(`${userId}:${reviewId}`)
    },
    async listUsers() {
      return [...users.values()]
    },
    async setBetaStatus(userId, status) {
      const user = users.get(userId)
      if (!user) return false
      user.betaStatus = status
      return true
    },
    async dismissOnboarding() {
      dismissed = true
    },
    async guide() {
      return {
        limitations: ['Beta data can change.'],
        dismissed,
        steps: [],
      }
    },
    async eventCounts() {
      return {
        REGISTRATION: 1,
        WORKSPACE_CREATED: 0,
        REPOSITORY_CONNECTED: 0,
        REVIEW_STARTED: 0,
        REVIEW_COMPLETED: 0,
        REPO_CHAT: 0,
        FEEDBACK_SUBMITTED: feedback.length,
      }
    },
  }
  return { store, feedback }
}

async function startServer(accounts: Record<string, Account>, store: BetaStore) {
  const app = express()
  app.use(express.json())
  app.use(
    '/beta',
    createBetaRouter(
      createAuthMiddleware(async (userId) => accounts[userId] ?? null),
      new BetaService(store)
    )
  )
  const server = app.listen(0)
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

function session(userId: string, email: string): string {
  const token = generateToken({ userId, email, tokenVersion: 0 })
  return `${env.AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`
}

test('beta feedback is owner scoped and administration fails closed', async () => {
  const previousAdmins = process.env.BETA_ADMIN_EMAILS
  process.env.BETA_ADMIN_EMAILS = 'admin@example.com'
  const events: string[] = []
  setProductEventWriter(async (_userId, name) => {
    events.push(name)
  })
  const { store, feedback } = memoryStore()
  const accounts: Record<string, Account> = {
    'user-active': { email: 'active@example.com', betaStatus: 'ACTIVE', isVerified: true, tokenVersion: 0 },
    'user-other': { email: 'other@example.com', betaStatus: 'ACTIVE', isVerified: true, tokenVersion: 0 },
    'user-pending': { email: 'pending@example.com', betaStatus: 'PENDING', isVerified: true, tokenVersion: 0 },
    'user-admin': { email: 'admin@example.com', betaStatus: 'ACTIVE', isVerified: true, tokenVersion: 0 },
  }
  const server = await startServer(accounts, store)
  try {
    const missing = await fetch(`${server.baseUrl}/beta/feedback`)
    assert.equal(missing.status, 401)

    const pending = await fetch(`${server.baseUrl}/beta/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: session('user-pending', 'pending@example.com') },
      body: JSON.stringify({ category: 'BUG', subject: 'Pending user', body: 'Should not be stored' }),
    })
    assert.equal(pending.status, 403)
    const pendingBody = await pending.json() as { code?: string }
    assert.equal(pendingBody.code, 'BETA_ACCESS_REQUIRED')

    const created = await fetch(`${server.baseUrl}/beta/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: session('user-active', 'active@example.com') },
      body: JSON.stringify({ category: 'BUG', subject: 'Review page error', body: 'The findings list stays empty.' }),
    })
    assert.equal(created.status, 201)
    const unownedReview = await fetch(`${server.baseUrl}/beta/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: session('user-other', 'other@example.com') },
      body: JSON.stringify({
        category: 'REVIEW_QUALITY',
        subject: 'Not my review',
        body: 'Trying another user review',
        rating: 2,
        reviewId: 'review_12345678',
      }),
    })
    assert.equal(unownedReview.status, 404)

    const ownList = await fetch(`${server.baseUrl}/beta/feedback`, {
      headers: { cookie: session('user-other', 'other@example.com') },
    })
    assert.equal(ownList.status, 200)
    const ownBody = await ownList.json() as { feedback: ProductFeedbackRecord[] }
    assert.equal(ownBody.feedback.length, 0)

    const denied = await fetch(`${server.baseUrl}/beta/admin/overview`, {
      headers: { cookie: session('user-active', 'active@example.com') },
    })
    assert.equal(denied.status, 403)

    const overview = await fetch(`${server.baseUrl}/beta/admin/overview`, {
      headers: { cookie: session('user-admin', 'admin@example.com') },
    })
    assert.equal(overview.status, 200)
    const overviewBody = await overview.json() as { feedback: ProductFeedbackRecord[]; usage: { FEEDBACK_SUBMITTED: number } }
    assert.equal(overviewBody.feedback.length, 1)
    assert.equal(overviewBody.usage.FEEDBACK_SUBMITTED, 1)
    assert.equal(JSON.stringify(overviewBody).includes('findings list'), true)
    assert.equal(JSON.stringify(overviewBody).includes('postgres://'), false)

    const updated = await fetch(`${server.baseUrl}/beta/admin/feedback/feedback-1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: session('user-admin', 'admin@example.com') },
      body: JSON.stringify({ status: 'TRIAGED' }),
    })
    assert.equal(updated.status, 200)
    assert.equal(feedback[0]?.status, 'TRIAGED')
    assert.deepEqual(events, ['FEEDBACK_SUBMITTED'])
  } finally {
    await server.close()
    if (previousAdmins === undefined) delete process.env.BETA_ADMIN_EMAILS
    else process.env.BETA_ADMIN_EMAILS = previousAdmins
    useDefaultProductEventWriter()
  }
})
