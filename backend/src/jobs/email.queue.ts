import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

import { MailService } from "../modules/email/mail.service.js";
import { env } from "../config/env.js";

const connection = new (IORedis as unknown as {
  new (url: string, options?: { maxRetriesPerRequest: number | null }): any;
})(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const emailQueue = new Queue("email", {
  connection,
});

const mailer = new MailService();

export const emailWorker = new Worker(
  "email",
  async (job) => {
    const { type, payload } = job.data;

    switch (type) {
      case "review:complete":
        await mailer.sendReviewComplete(payload);
        break;

      default:
        console.warn(`Unknown job type: ${type}`);
    }
  },
  {
    connection,
  }
);

emailWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

emailWorker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed`, err);
});

emailWorker.on("error", (err) => {
  console.error("Worker Error:", err);
});