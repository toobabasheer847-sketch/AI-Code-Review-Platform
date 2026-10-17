import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@/config/env';
import logger from '@/utils/logger';
import { SocialService } from './social.service';
import type { SocialPublishJob } from './social.queue';

let worker: Worker<SocialPublishJob> | null = null;
const service = new SocialService();

export async function startSocialWorker(): Promise<void> {
  if (worker) return;
  await service.recoverInterruptedPublications();
  worker = new Worker<SocialPublishJob>(
    'social-publishing',
    async (job) => service.publishScheduledPost(job.data.postId, job.data.scheduleVersion),
    {
      connection: new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }),
      concurrency: 2,
      lockDuration: 180_000,
    }
  );
  worker.on('failed', (job, error) => {
    logger.error(
      { postId: job?.data.postId, errorType: error.name },
      'Social publication job failed before a terminal result was persisted'
    );
  });
  await worker.waitUntilReady();
}

export async function stopSocialWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
}
