import { Queue } from 'bullmq';
import { createBullMqRedisConnection } from '@/config/redis-connection';

export interface SocialPublishJob {
  postId: string;
  scheduleVersion: number;
}

let connection: ReturnType<typeof createBullMqRedisConnection> | null = null;
let queue: Queue<SocialPublishJob> | null = null;

function getConnection(): ReturnType<typeof createBullMqRedisConnection> {
  if (!connection) connection = createBullMqRedisConnection();
  return connection;
}

function getQueue(): Queue<SocialPublishJob> {
  if (!queue) {
    queue = new Queue<SocialPublishJob>('social-publishing', {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 500,
        removeOnFail: 1_000,
      },
    });
  }
  return queue;
}

export const socialQueue = new Proxy({} as Queue<SocialPublishJob>, {
  get(_target, property) {
    const instance = getQueue();
    const value = Reflect.get(instance, property, instance);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

export function socialPublishJobId(postId: string, scheduleVersion: number): string {
  return `social-post-${postId}-${scheduleVersion}`;
}

export async function enqueueSocialPublication(
  input: SocialPublishJob,
  delayMs: number
): Promise<void> {
  await getQueue().add('publish', input, {
    jobId: socialPublishJobId(input.postId, input.scheduleVersion),
    delay: Math.max(0, delayMs),
  });
}

export async function closeSocialQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
