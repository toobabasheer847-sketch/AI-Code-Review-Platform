import {
  AutomationScheduleFrequency,
  AutomationScheduleRunStatus,
  AutomationScheduleStatus,
  AutomationStatus,
} from '@prisma/client';
import { prisma } from '@/config/database';
import logger from '@/utils/logger';
import { automationQueue } from './automation.queue';
import { AutomationService } from './automation.service';
import { createDailyAutomationSummaries, createAutomationNotification, dispatchPendingAutomationNotifications } from './automation-notifications';
import {
  AUTOMATION_RECOVERY_STALE_MS,
  MAX_CONSECUTIVE_SCHEDULE_FAILURES,
  automationRecoveryJobId,
  canExecuteScheduledRun,
  isRecoverableAutomation,
  scheduledAutomationIdempotencyKey,
  shouldSkipMissedOccurrences,
  nextScheduledInstant,
} from './schedule.domain';
import { validatePlan } from './automation.domain';
import type { VisualWorkflowDefinition } from './visual-workflow.domain';

const POLL_INTERVAL_MS = 15_000;
const MAX_DUE_SCHEDULES_PER_TICK = 100;
const FAILURE_NOTIFICATION_THRESHOLD = 3;
const ACTIVE_SCHEDULE_RUN_STATUSES = [
  AutomationScheduleRunStatus.AWAITING_APPROVAL,
  AutomationScheduleRunStatus.QUEUED,
  AutomationScheduleRunStatus.RUNNING,
];

function scheduleRunStatusForAutomation(status: AutomationStatus): AutomationScheduleRunStatus {
  if (status === AutomationStatus.AWAITING_APPROVAL) {
    return AutomationScheduleRunStatus.AWAITING_APPROVAL;
  }
  if (status === AutomationStatus.RUNNING) return AutomationScheduleRunStatus.RUNNING;
  return AutomationScheduleRunStatus.QUEUED;
}

let timer: NodeJS.Timeout | null = null;
let activeTick: Promise<void> | null = null;
let lastSuccessfulTickAt: Date | null = null;
let lastFailureAt: Date | null = null;
let lastFailureType: string | null = null;

export function getAutomationSchedulerHealth() {
  return {
    running: timer !== null,
    tickInProgress: activeTick !== null,
    lastSuccessfulTickAt,
    lastFailureAt,
    lastFailureType,
  };
}

function countOverdueOccurrences(input: {
  nextRunAt: Date;
  now: Date;
  frequency: AutomationScheduleFrequency;
  timeZone: string;
  localTime: string;
  dayOfWeek: number | null;
}): number {
  let cursor = input.nextRunAt;
  let missed = 0;
  while (cursor.getTime() <= input.now.getTime()) {
    if (missed >= 100_000) {
      throw new Error('Schedule outage exceeds the supported missed-occurrence count.');
    }
    missed += 1;
    cursor = nextScheduledInstant({
      frequency: input.frequency,
      timeZone: input.timeZone,
      localTime: input.localTime,
      dayOfWeek: input.dayOfWeek,
      after: cursor,
    });
  }
  return missed;
}

async function claimDueSchedule(scheduleId: string, now: Date): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const [locked] = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "AutomationSchedule" WHERE "id" = ${scheduleId} FOR UPDATE
    `;
    if (!locked) return;
    const schedule = await transaction.automationSchedule.findUnique({ where: { id: scheduleId } });
    if (
      !schedule ||
      schedule.status !== AutomationScheduleStatus.ACTIVE ||
      schedule.nextRunAt.getTime() > now.getTime()
    ) {
      return;
    }
    const scheduledFor = schedule.nextRunAt;
    const missedCount = countOverdueOccurrences({
      nextRunAt: scheduledFor,
      now,
      frequency: schedule.frequency,
      timeZone: schedule.timeZone,
      localTime: schedule.localTime,
      dayOfWeek: schedule.dayOfWeek,
    });
    const tooLate = shouldSkipMissedOccurrences(missedCount);
    const nextRunAt = nextScheduledInstant({
      frequency: schedule.frequency,
      timeZone: schedule.timeZone,
      localTime: schedule.localTime,
      dayOfWeek: schedule.dayOfWeek,
      after: now,
    });
    await transaction.automationScheduleRun.create({
      data: {
        scheduleId,
        scheduledFor,
        status: tooLate ? AutomationScheduleRunStatus.SKIPPED : AutomationScheduleRunStatus.PENDING,
        errorCode: tooLate ? 'MISSED_DURING_OUTAGE' : null,
      },
    });
    await transaction.automationSchedule.update({
      where: { id: scheduleId },
      data: {
        nextRunAt,
        lastRunAt: tooLate ? now : schedule.lastRunAt,
        ...(tooLate ? { missedRuns: { increment: missedCount } } : {}),
      },
    });
    if (tooLate) {
      const sourceExists = await transaction.automation.findFirst({
        where: { id: schedule.sourceAutomationId, userId: schedule.userId },
        select: { id: true },
      });
      if (sourceExists) {
        await transaction.automationEvent.create({
          data: {
            automationId: sourceExists.id,
            type: 'scheduled_run_missed',
            message: `${missedCount} scheduled occurrence(s) were skipped after the service was unavailable. The next future occurrence remains scheduled.`,
          },
        });
      }
    }
  });
}

async function claimDueSchedules(now: Date): Promise<void> {
  const due = await prisma.automationSchedule.findMany({
    where: { status: AutomationScheduleStatus.ACTIVE, nextRunAt: { lte: now } },
    select: { id: true },
    orderBy: { nextRunAt: 'asc' },
    take: MAX_DUE_SCHEDULES_PER_TICK,
  });
  for (const schedule of due) await claimDueSchedule(schedule.id, now);
}

async function failScheduledOccurrence(
  scheduleId: string,
  scheduledFor: Date,
  userId: string,
  error: unknown
): Promise<void> {
  const errorType = error instanceof Error ? error.name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) : 'UnknownError';
  const current = await prisma.automationSchedule.findUnique({
    where: { id: scheduleId },
    select: { title: true, consecutiveFailures: true },
  });
  if (!current) return;
  const preferences = await prisma.automationNotificationPreference.findUnique({ where: { userId } });
  const nextFailureCount = current.consecutiveFailures + 1;
  if (preferences?.failureNotifications ?? true) {
    await createAutomationNotification({
      userId,
      dedupeKey: `schedule-failed:${scheduleId}:${scheduledFor.toISOString()}`,
      subject: `Scheduled workflow failed: ${current.title}`,
      heading: 'A scheduled workflow could not be started',
      details: [
        `Failure category: ${errorType}`,
        'The workflow was not reported as successful. Review the schedule and execution history.',
      ],
    });
    if (
      nextFailureCount >=
      (preferences?.repeatedFailureThreshold ?? FAILURE_NOTIFICATION_THRESHOLD)
    ) {
      await createAutomationNotification({
        userId,
        dedupeKey: `schedule-repeated-failure:${scheduleId}:${nextFailureCount}`,
        subject: `Repeated scheduled workflow failures: ${current.title}`,
        heading: 'Repeated scheduled workflow failures',
        details: [
          `This schedule has failed ${nextFailureCount} consecutive times.`,
          nextFailureCount >= MAX_CONSECUTIVE_SCHEDULE_FAILURES
            ? 'The schedule reached the automatic-pause threshold.'
            : 'Review the recent execution errors before the next run.',
        ],
      });
    }
  }
  await prisma.$transaction(async (transaction) => {
    const failed = await transaction.automationScheduleRun.updateMany({
      where: { scheduleId, scheduledFor, status: AutomationScheduleRunStatus.PENDING },
      data: { status: AutomationScheduleRunStatus.FAILED, errorCode: errorType || 'SCHEDULE_EXECUTION_FAILED' },
    });
    if (failed.count !== 1) return;
    const updated = await transaction.automationSchedule.update({
      where: { id: scheduleId },
      data: { consecutiveFailures: { increment: 1 } },
      select: { consecutiveFailures: true, status: true },
    });
    if (
      updated.status === AutomationScheduleStatus.ACTIVE &&
      updated.consecutiveFailures >= MAX_CONSECUTIVE_SCHEDULE_FAILURES
    ) {
      await transaction.automationSchedule.update({
        where: { id: scheduleId },
        data: { status: AutomationScheduleStatus.PAUSED },
      });
    }
  });
}

async function createPendingScheduleExecutions(): Promise<void> {
  const runs = await prisma.automationScheduleRun.findMany({
    where: { status: AutomationScheduleRunStatus.PENDING },
    include: { schedule: true },
    orderBy: { scheduledFor: 'asc' },
    take: MAX_DUE_SCHEDULES_PER_TICK,
  });
  const workflows = new AutomationService();
  for (const run of runs) {
    if (!canExecuteScheduledRun(run.schedule.status)) {
      await prisma.automationScheduleRun.updateMany({
        where: { id: run.id, status: AutomationScheduleRunStatus.PENDING },
        data: { status: AutomationScheduleRunStatus.SKIPPED, errorCode: 'SCHEDULE_PAUSED' },
      });
      continue;
    }
    try {
      const plan = validatePlan(run.schedule.plan);
      const automation = await workflows.create(run.schedule.userId, {
        goal: run.schedule.goal,
        mode: run.schedule.mode,
        plan,
        workflowDefinition: run.schedule.workflowDefinition as unknown as VisualWorkflowDefinition,
        scheduleId: run.scheduleId,
        scheduledFor: run.scheduledFor,
        idempotencyKey: scheduledAutomationIdempotencyKey(run.scheduleId, run.scheduledFor),
      });
      const created = await prisma.automationScheduleRun.updateMany({
        where: { id: run.id, status: AutomationScheduleRunStatus.PENDING },
        data: {
          status: scheduleRunStatusForAutomation(automation.status),
          automationId: automation.id,
        },
      });
      if (created.count === 1) {
        await prisma.automationSchedule.updateMany({
          where: { id: run.scheduleId },
          data: { totalRuns: { increment: 1 }, lastRunAt: run.scheduledFor },
        });
      }
    } catch (error) {
      const alreadyCreated = await prisma.automation.findFirst({
        where: {
          userId: run.schedule.userId,
          scheduleId: run.scheduleId,
          scheduledFor: run.scheduledFor,
        },
        select: { id: true },
      });
      if (alreadyCreated) {
        const created = await prisma.automationScheduleRun.updateMany({
          where: { id: run.id, status: AutomationScheduleRunStatus.PENDING },
          data: {
            status: AutomationScheduleRunStatus.QUEUED,
            automationId: alreadyCreated.id,
          },
        });
        if (created.count === 1) {
          await prisma.automationSchedule.updateMany({
            where: { id: run.scheduleId },
            data: { totalRuns: { increment: 1 }, lastRunAt: run.scheduledFor },
          });
        }
        logger.warn(
          { scheduleId: run.scheduleId, automationId: alreadyCreated.id },
          'Recovered a persisted scheduled automation after queue submission failed'
        );
        continue;
      }
      logger.error(
        { scheduleId: run.scheduleId, errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Scheduled workflow occurrence could not be created'
      );
      await failScheduledOccurrence(run.scheduleId, run.scheduledFor, run.schedule.userId, error);
    }
  }
}

async function syncCompletedScheduleExecutions(): Promise<void> {
  const runs = await prisma.automationScheduleRun.findMany({
    where: { status: { in: ACTIVE_SCHEDULE_RUN_STATUSES }, automationId: { not: null } },
    include: { schedule: { select: { id: true, userId: true, title: true } } },
    take: MAX_DUE_SCHEDULES_PER_TICK,
  });
  for (const run of runs) {
    if (!run.automationId) continue;
    const automation = await prisma.automation.findFirst({
      where: { id: run.automationId, userId: run.schedule.userId },
      select: { status: true },
    });
    if (!automation) {
      await prisma.automationScheduleRun.updateMany({
        where: { id: run.id, status: { in: ACTIVE_SCHEDULE_RUN_STATUSES } },
        data: { status: AutomationScheduleRunStatus.SKIPPED, errorCode: 'AUTOMATION_MISSING' },
      });
      continue;
    }
    if (
      automation.status === AutomationStatus.AWAITING_APPROVAL ||
      automation.status === AutomationStatus.QUEUED ||
      automation.status === AutomationStatus.RUNNING
    ) {
      const status = scheduleRunStatusForAutomation(automation.status);
      if (status !== run.status) {
        await prisma.automationScheduleRun.updateMany({
          where: { id: run.id, status: { in: ACTIVE_SCHEDULE_RUN_STATUSES } },
          data: { status },
        });
      }
      continue;
    }

    if (automation.status === AutomationStatus.COMPLETED) {
      const changed = await prisma.automationScheduleRun.updateMany({
        where: { id: run.id, status: { in: ACTIVE_SCHEDULE_RUN_STATUSES } },
        data: { status: AutomationScheduleRunStatus.COMPLETED },
      });
      if (changed.count === 1) {
        await prisma.automationSchedule.updateMany({
          where: { id: run.scheduleId },
          data: { consecutiveFailures: 0 },
        });
      }
    } else if (
      automation.status === AutomationStatus.CANCELED ||
      automation.status === AutomationStatus.REJECTED
    ) {
      await prisma.automationScheduleRun.updateMany({
        where: { id: run.id, status: { in: ACTIVE_SCHEDULE_RUN_STATUSES } },
        data: {
          status: AutomationScheduleRunStatus.SKIPPED,
          errorCode: automation.status === AutomationStatus.CANCELED ? 'EXECUTION_CANCELED' : 'EXECUTION_REJECTED',
        },
      });
    } else if (automation.status === AutomationStatus.FAILED) {
      const currentSchedule = await prisma.automationSchedule.findUnique({
        where: { id: run.scheduleId },
        select: { consecutiveFailures: true },
      });
      const preferences = await prisma.automationNotificationPreference.findUnique({
        where: { userId: run.schedule.userId },
      });
      const nextFailureCount = (currentSchedule?.consecutiveFailures ?? 0) + 1;
      const threshold = preferences?.repeatedFailureThreshold ?? FAILURE_NOTIFICATION_THRESHOLD;
      if (preferences?.failureNotifications ?? true) {
        await createAutomationNotification({
          userId: run.schedule.userId,
          dedupeKey: `schedule-execution-failed:${run.id}`,
          subject: `Scheduled workflow failed: ${run.schedule.title}`,
          heading: 'A scheduled workflow failed',
          details: ['The workflow reached a terminal failed state after its bounded retries.'],
        });
        if (nextFailureCount >= threshold) {
          await createAutomationNotification({
            userId: run.schedule.userId,
            dedupeKey: `schedule-repeated-failure:${run.scheduleId}:${nextFailureCount}`,
            subject: `Repeated scheduled workflow failures: ${run.schedule.title}`,
            heading: 'Repeated scheduled workflow failures',
            details: [`This schedule has failed ${nextFailureCount} consecutive times.`],
          });
        }
      }

      await prisma.$transaction(async (transaction) => {
        const changed = await transaction.automationScheduleRun.updateMany({
          where: { id: run.id, status: { in: ACTIVE_SCHEDULE_RUN_STATUSES } },
          data: { status: AutomationScheduleRunStatus.FAILED, errorCode: 'WORKFLOW_FAILED' },
        });
        if (changed.count !== 1) return;
        const schedule = await transaction.automationSchedule.update({
          where: { id: run.scheduleId },
          data: { consecutiveFailures: { increment: 1 } },
          select: { consecutiveFailures: true, status: true },
        });
        if (schedule.consecutiveFailures >= MAX_CONSECUTIVE_SCHEDULE_FAILURES) {
          await transaction.automationSchedule.updateMany({
            where: { id: run.scheduleId, status: AutomationScheduleStatus.ACTIVE },
            data: { status: AutomationScheduleStatus.PAUSED },
          });
        }
      });
    }
  }
}

async function recoverQueuedWorkflows(now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - AUTOMATION_RECOVERY_STALE_MS);
  const queued = await prisma.automation.findMany({
    where: {
      status: { in: [AutomationStatus.QUEUED, AutomationStatus.RUNNING] },
      updatedAt: { lt: staleBefore },
    },
    select: { id: true, retryCount: true, status: true, updatedAt: true },
    take: 100,
  });
  for (const automation of queued) {
    if (!isRecoverableAutomation(automation.status, automation.updatedAt, now)) continue;
    await automationQueue.add(
      'execute-recovery',
      { automationId: automation.id },
      {
        jobId: automationRecoveryJobId(automation.id, automation.retryCount, now),
        delay: 1_000,
      }
    );
  }
}

export function runAutomationSchedulerTick(now = new Date()): Promise<void> {
  if (activeTick) return activeTick;
  activeTick = (async () => {
    try {
      await claimDueSchedules(now);
      await createPendingScheduleExecutions();
      await syncCompletedScheduleExecutions();
      await recoverQueuedWorkflows(now);
      await createDailyAutomationSummaries(now);
      await dispatchPendingAutomationNotifications(now);
      lastSuccessfulTickAt = now;
      lastFailureType = null;
    } catch (error) {
      lastFailureAt = now;
      lastFailureType =
        error instanceof Error ? error.name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) : 'UnknownError';
      logger.error({ errorType: lastFailureType }, 'Automation scheduler tick failed; persisted work will be retried');
    } finally {
      activeTick = null;
    }
  })();
  return activeTick;
}

export function startAutomationScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void runAutomationSchedulerTick(), POLL_INTERVAL_MS);
  timer.unref();
  void runAutomationSchedulerTick();
}

export async function stopAutomationScheduler(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  await activeTick;
}
