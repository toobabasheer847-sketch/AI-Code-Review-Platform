import { prisma } from '@/config/database';
import { env } from '@/config/env';
import { emailQueue } from '@/jobs/email.queue';
import { isDueSummaryTime } from './schedule.domain';

const OUTBOX_STALE_MS = 5 * 60 * 1_000;

export async function createAutomationNotification(input: {
  userId: string;
  dedupeKey: string;
  subject: string;
  heading: string;
  details: string[];
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, isVerified: true },
  });
  if (!user?.isVerified) return;
  await prisma.automationNotification.createMany({
    data: [{
      userId: input.userId,
      dedupeKey: input.dedupeKey,
      recipient: user.email,
      subject: input.subject.replace(/[\r\n]+/g, ' ').slice(0, 180),
      heading: input.heading.slice(0, 180),
      details: input.details.slice(0, 12).map((item) => item.slice(0, 500)),
      link: `${env.FRONTEND_URL}/automations?view=history`,
    }],
    skipDuplicates: true,
  });
}

export async function dispatchPendingAutomationNotifications(now = new Date()): Promise<void> {
  const outbox = await prisma.automationNotification.findMany({
    where: {
      OR: [
        { status: 'PENDING' },
        { status: 'QUEUED', queuedAt: { lt: new Date(now.getTime() - OUTBOX_STALE_MS) } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  for (const notification of outbox) {
    const claim = await prisma.automationNotification.updateMany({
      where: {
        id: notification.id,
        OR: [
          { status: 'PENDING' },
          { status: 'QUEUED', queuedAt: { lt: new Date(now.getTime() - OUTBOX_STALE_MS) } },
        ],
      },
      data: { status: 'QUEUED', queuedAt: now },
    });
    if (claim.count !== 1) continue;
    try {
      await emailQueue.add(
        'automation-notification',
        {
          type: 'automation:notification',
          payload: {
            outboxId: notification.id,
            to: notification.recipient,
            subject: notification.subject,
            heading: notification.heading,
            details: notification.details,
            url: notification.link,
          },
        },
        { jobId: `automation-notification-${notification.id}-${now.getTime()}` }
      );
    } catch (error) {
      await prisma.automationNotification.updateMany({
        where: { id: notification.id, status: 'QUEUED', queuedAt: now },
        data: { status: 'PENDING', queuedAt: null },
      });
      throw error;
    }
  }
}

export async function createDailyAutomationSummaries(now = new Date()): Promise<void> {
  let cursor: string | undefined;
  let firstError: unknown;
  let morePages = true;
  while (morePages) {
    const preferences = await prisma.automationNotificationPreference.findMany({
      where: { dailySummaryEnabled: true, user: { isVerified: true } },
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: 200,
    });
    if (preferences.length === 0) {
      if (firstError) throw firstError;
      return;
    }
    for (const preference of preferences) {
      const due = isDueSummaryTime({
        now,
        timeZone: preference.dailySummaryTimeZone,
        localTime: preference.dailySummaryTime,
        lastSentLocalDate: preference.lastSummaryLocalDate,
      });
      if (!due.due) continue;
      const claimed = await prisma.automationNotificationPreference.updateMany({
        where: {
          id: preference.id,
          OR: [{ lastSummaryLocalDate: null }, { lastSummaryLocalDate: { not: due.localDate } }],
        },
        data: { lastSummaryLocalDate: due.localDate },
      });
      if (claimed.count !== 1) continue;

      try {
        const events = await prisma.automationEvent.findMany({
          where: {
            automation: { userId: preference.userId },
            createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1_000) },
            type: {
              in: ['created', 'approved', 'action_executed', 'action_failed', 'completed', 'canceled'],
            },
          },
          select: { type: true, message: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        await createAutomationNotification({
          userId: preference.userId,
          dedupeKey: `automation-daily-summary:${preference.userId}:${due.localDate}`,
          subject: 'Your AI CodeGuard automation activity summary',
          heading: 'Daily workflow activity summary',
          details:
            events.length > 0
              ? events.map((event) => `${event.type}: ${event.message}`)
              : ['No workflow activity was recorded in the last 24 hours.'],
        });
      } catch (error) {
        await prisma.automationNotificationPreference.updateMany({
          where: { id: preference.id, lastSummaryLocalDate: due.localDate },
          data: { lastSummaryLocalDate: preference.lastSummaryLocalDate },
        });
        firstError ??= error;
      }
    }
    if (preferences.length < 200) {
      if (firstError) throw firstError;
      morePages = false;
      continue;
    }
    cursor = preferences[preferences.length - 1]!.id;
  }
}
