import { DelayedError, Worker } from 'bullmq'
import { env } from '@/config/env'
import { createBullMqRedisConnection } from '@/config/redis-connection'
import { getConfiguredFixVerificationRunner } from '@/modules/code-review/fix-verification.runner'
import { prismaVerificationJobStore } from '@/modules/code-review/fix-verification.job-store'
import {
  buildAttemptCompletion,
  processVerificationJob,
  reconcileStaleVerificationJobs,
  RetryableVerificationDispatchError,
} from '@/modules/code-review/fix-verification.lifecycle'
import logger from '@/utils/logger'
import { reportBackendError } from '@/utils/error-monitoring'
import {
  enqueueFixVerificationJob,
  isDuplicateJobError,
  type FixVerificationJobData,
} from './fix-verification.queue'

const connection = createBullMqRedisConnection()
let reconcileTimer: NodeJS.Timeout | null = null

async function reconcile(): Promise<void> {
  const runner = getConfiguredFixVerificationRunner()
  if (!runner) return
  await reconcileStaleVerificationJobs(
    prismaVerificationJobStore,
    runner,
    new Date(),
    env.FIX_VERIFICATION_STALE_AFTER_MS
  )
}

export async function recoverFixVerificationJobs(): Promise<void> {
  const queued = await prismaVerificationJobStore.listQueued()
  for (const attemptId of queued) {
    try {
      await enqueueFixVerificationJob(attemptId)
    } catch (error) {
      if (!isDuplicateJobError(error)) throw error
    }
  }
  await reconcile()
}

const worker = new Worker<FixVerificationJobData>(
  'fix-verification',
  async (job, token) => {
    const runner = getConfiguredFixVerificationRunner()
    if (!runner) {
      const current = await prismaVerificationJobStore.findJob(job.data.attemptId)
      if (!current || current.jobState === 'QUEUED' || current.jobState === 'RUNNING') {
        if (current) {
          await prismaVerificationJobStore.complete(
            buildAttemptCompletion({
              attemptId: current.id,
              expectedPatchSha256: current.patchSha256,
              expectedCommitSha: current.commitSha,
              result: null,
              runnerConfigured: false,
              startedAt: current.startedAt,
              completedAt: new Date(),
            })
          )
        }
      }
      return
    }
    const outcome = await processVerificationJob(
      prismaVerificationJobStore,
      runner,
      job.data.attemptId,
      { maxDispatchAttempts: env.FIX_VERIFICATION_MAX_DISPATCH_ATTEMPTS }
    )
    if (outcome.kind === 'retry') throw new RetryableVerificationDispatchError()
    if (outcome.kind === 'pending') {
      await job.moveToDelayed(Date.now() + 5_000, token)
      throw new DelayedError()
    }
  },
  { connection, autorun: false }
)

worker.on('failed', (job, error) => {
  if (error instanceof RetryableVerificationDispatchError || error instanceof DelayedError) return
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    reportBackendError(error, 'verification-worker')
  }
  logger.error({ attemptId: job?.data.attemptId }, 'Fix verification job failed')
})

worker.on('error', (error) => {
  reportBackendError(error, 'verification-worker')
  logger.error(
    { errorType: error instanceof Error ? error.name : 'UnknownError' },
    'Fix verification worker error'
  )
})

export async function startFixVerificationWorker(): Promise<void> {
  await recoverFixVerificationJobs()
  void worker.run().catch((error: unknown) => {
    reportBackendError(error, 'verification-worker')
    logger.error('Fix verification worker stopped unexpectedly')
  })
  reconcileTimer = setInterval(() => {
    void reconcile().catch((error: unknown) => {
      reportBackendError(error, 'verification-worker')
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Fix verification reconciliation failed'
      )
    })
  }, 60_000)
  reconcileTimer.unref()
}

export async function stopFixVerificationWorker(): Promise<void> {
  if (reconcileTimer) {
    clearInterval(reconcileTimer)
    reconcileTimer = null
  }
  await worker.close()
  await connection.quit()
}
