import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { resolveDisposableTestDatabaseUrl } from '@/testing/disposable-database'

const testDatabaseUrl = resolveDisposableTestDatabaseUrl()

test(
  'product feedback moves from submission to admin status without storing source code',
  { skip: !testDatabaseUrl },
  async () => {
    const [{ prisma }, { BetaService }, { recordProductEvent }] = await Promise.all([
      import('@/config/database'),
      import('./beta.service'),
      import('./product-events'),
    ])
    const ownerId = randomUUID()
    const otherId = randomUUID()
    const repositoryId = randomUUID()
    const reviewId = randomUUID()
    const sourceSentinel = `source-sentinel-${randomUUID()}`
    const service = new BetaService()
    try {
      await prisma.user.createMany({
        data: [
          { id: ownerId, email: `${ownerId}@beta.test`, fullName: 'Beta Owner', passwordHash: 'not-a-password' },
          { id: otherId, email: `${otherId}@beta.test`, fullName: 'Beta Other', passwordHash: 'not-a-password' },
        ],
      })
      await prisma.repository.create({
        data: { id: repositoryId, userId: ownerId, name: 'example', url: `https://example.test/${repositoryId}` },
      })
      await prisma.codeReview.create({
        data: {
          id: reviewId,
          userId: ownerId,
          repositoryId,
          title: 'Beta review',
          fileContent: sourceSentinel,
        },
      })

      const created = await service.submit(ownerId, {
        category: 'REVIEW_QUALITY',
        subject: 'Useful summary',
        body: 'The review was clear.',
        rating: 4,
        reviewId,
      })
      await recordProductEvent(ownerId, 'REVIEW_COMPLETED')
      const otherView = await service.listOwn(otherId)
      const triaged = await service.updateStatus(created.id, { status: 'TRIAGED' })
      const stored = await prisma.productFeedback.findUniqueOrThrow({ where: { id: created.id } })
      const events = await prisma.productEvent.findMany({ where: { userId: ownerId }, select: { name: true } })

      assert.deepEqual(otherView, [])
      assert.equal(triaged.status, 'TRIAGED')
      assert.equal(stored.body, 'The review was clear.')
      assert.equal(stored.body.includes(sourceSentinel), false)
      assert.equal(stored.rating, 4)
      assert.deepEqual(events.map((event) => event.name).sort(), ['FEEDBACK_SUBMITTED', 'REVIEW_COMPLETED'])
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } })
    }
  }
)
