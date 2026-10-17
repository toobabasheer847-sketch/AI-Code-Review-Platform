import {
  AutomationMode,
  AutomationScheduleFrequency,
  AutomationScheduleStatus,
  AutomationStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/config/database';
import { hasProReviewAccess } from '@/modules/billing/review-quota';
import {
  AutomationError,
  automationActionCatalog,
  MAX_AUTOMATION_TASKS,
  validatePlan,
} from './automation.domain';
import { AutomationService } from './automation.service';
import {
  activeScheduleLimit,
  nextScheduledInstant,
  validateScheduleInput,
} from './schedule.domain';
import type { VisualWorkflowDefinition } from './visual-workflow.domain';

const scheduleInclude = {
  runs: { orderBy: { scheduledFor: 'desc' as const }, take: 20 },
  executions: {
    orderBy: { scheduledFor: 'desc' as const },
    take: 20,
    select: { id: true, status: true, scheduledFor: true, updatedAt: true },
  },
};

export class AutomationScheduleService {
  constructor(
    private readonly workflows = new AutomationService(),
    private readonly now = (): Date => new Date()
  ) {}

  async list(userId: string) {
    const [schedules, preference] = await Promise.all([
      prisma.automationSchedule.findMany({
        where: { userId },
        include: scheduleInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.getNotificationPreferences(userId),
    ]);
    return { schedules, notificationPreferences: preference };
  }

  async create(
    userId: string,
    input: {
      automationId: string;
      frequency: AutomationScheduleFrequency;
      timeZone: string;
      localTime: string;
      dayOfWeek?: number;
    }
  ) {
    validateScheduleInput(input);
    const source = await prisma.automation.findFirst({
      where: {
        id: input.automationId,
        userId,
        status: AutomationStatus.DRAFT,
        mode: AutomationMode.DRAFT_ONLY,
        workflowDefinition: { not: Prisma.JsonNull },
      },
      select: { id: true, title: true, goal: true, workflowDefinition: true },
    });
    if (!source?.workflowDefinition) {
      throw new AutomationError('Choose one of your saved visual workflow drafts.', 404);
    }
    const workflow = source.workflowDefinition as unknown as VisualWorkflowDefinition;
    const validated = await this.workflows.validateVisualWorkflow(userId, workflow);
    const plan = validatePlan(validated.plan);
    if (plan.tasks.length > MAX_AUTOMATION_TASKS) {
      throw new AutomationError('The workflow exceeds the supported scheduled task limit.', 400);
    }
    const needsApproval = plan.tasks.some((task) => {
      const action = automationActionCatalog.find((item) => item.id === task.action);
      return action?.approvalRequired ?? true;
    });
    const mode = needsApproval ? AutomationMode.APPROVAL_REQUIRED : AutomationMode.AUTO_LOW_RISK;
    const now = this.now();
    const nextRunAt = nextScheduledInstant({ ...input, after: now });
    const subscription = await prisma.subscription.findUnique({ where: { userId } });
    const scheduleLimit = activeScheduleLimit(hasProReviewAccess(subscription, now));

    const schedule = await prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const activeCount = await transaction.automationSchedule.count({
          where: { userId, status: AutomationScheduleStatus.ACTIVE },
        });
        if (activeCount >= scheduleLimit) {
          throw new AutomationError(
            hasProReviewAccess(subscription, now)
              ? `The active schedule limit of ${scheduleLimit} has been reached.`
              : 'The Free plan allows one active schedule. Upgrade to Pro for up to five.',
            429
          );
        }
        return transaction.automationSchedule.create({
          data: {
            userId,
            sourceAutomationId: source.id,
            title: source.title,
            goal: source.goal,
            workflowDefinition: workflow as unknown as Prisma.InputJsonValue,
            plan: plan as unknown as Prisma.InputJsonValue,
            mode,
            frequency: input.frequency,
            timeZone: input.timeZone,
            localTime: input.localTime,
            dayOfWeek: input.dayOfWeek,
            nextRunAt,
          },
          include: scheduleInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    return schedule;
  }

  async setStatus(
    userId: string,
    scheduleId: string,
    status: 'PAUSED' | 'ACTIVE'
  ) {
    const schedule = await prisma.automationSchedule.findFirst({
      where: { id: scheduleId, userId },
      select: {
        id: true,
        timeZone: true,
        frequency: true,
        localTime: true,
        dayOfWeek: true,
        status: true,
      },
    });
    if (!schedule || schedule.status === AutomationScheduleStatus.CANCELED) {
      throw new AutomationError('Schedule not found or already canceled.', 404);
    }
    if (schedule.status === status) {
      return prisma.automationSchedule.findFirst({
        where: { id: scheduleId, userId },
        include: scheduleInclude,
      });
    }
    const nextRunAt =
      status === AutomationScheduleStatus.ACTIVE
        ? nextScheduledInstant({
            frequency: schedule.frequency,
            timeZone: schedule.timeZone,
            localTime: schedule.localTime,
            dayOfWeek: schedule.dayOfWeek,
            after: this.now(),
          })
        : undefined;
    if (status === AutomationScheduleStatus.ACTIVE) {
      const now = this.now();
      const subscription = await prisma.subscription.findUnique({ where: { userId } });
      const limit = activeScheduleLimit(hasProReviewAccess(subscription, now));
      await prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
          const activeCount = await transaction.automationSchedule.count({
            where: { userId, status: AutomationScheduleStatus.ACTIVE },
          });
          if (activeCount >= limit) {
            throw new AutomationError(`The active schedule limit of ${limit} has been reached.`, 429);
          }
          const changed = await transaction.automationSchedule.updateMany({
            where: { id: scheduleId, userId, status: AutomationScheduleStatus.PAUSED },
            data: { status, ...(nextRunAt ? { nextRunAt } : {}) },
          });
          if (changed.count !== 1) throw new AutomationError('Schedule status changed; reload and try again.', 409);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } else {
      await prisma.automationSchedule.updateMany({
        where: { id: scheduleId, userId, status: AutomationScheduleStatus.ACTIVE },
        data: { status },
      });
    }
    return prisma.automationSchedule.findFirst({
      where: { id: scheduleId, userId },
      include: scheduleInclude,
    });
  }

  async update(
    userId: string,
    scheduleId: string,
    input: {
      frequency: AutomationScheduleFrequency;
      timeZone: string;
      localTime: string;
      dayOfWeek?: number;
    }
  ) {
    validateScheduleInput(input);
    const nextRunAt = nextScheduledInstant({ ...input, after: this.now() });
    await prisma.$transaction(async (transaction) => {
      const [locked] = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AutomationSchedule"
        WHERE "id" = ${scheduleId} AND "userId" = ${userId}
        FOR UPDATE
      `;
      if (!locked) throw new AutomationError('Schedule not found.', 404);
      const schedule = await transaction.automationSchedule.findFirst({
        where: { id: scheduleId, userId },
        select: { status: true },
      });
      if (!schedule || schedule.status === AutomationScheduleStatus.CANCELED) {
        throw new AutomationError('Schedule not found or already canceled.', 404);
      }
      await transaction.automationSchedule.update({
        where: { id: scheduleId },
        data: {
          frequency: input.frequency,
          timeZone: input.timeZone,
          localTime: input.localTime,
          dayOfWeek: input.dayOfWeek ?? null,
          nextRunAt,
        },
      });
    });
    return prisma.automationSchedule.findFirst({
      where: { id: scheduleId, userId },
      include: scheduleInclude,
    });
  }

  async cancel(userId: string, scheduleId: string) {
    const changed = await prisma.$transaction(async (transaction) => {
      const result = await transaction.automationSchedule.updateMany({
        where: {
          id: scheduleId,
          userId,
          status: { not: AutomationScheduleStatus.CANCELED },
        },
        data: { status: AutomationScheduleStatus.CANCELED },
      });
      if (result.count === 1) {
        await transaction.automationScheduleRun.updateMany({
          where: { scheduleId, status: 'PENDING' },
          data: { status: 'SKIPPED', errorCode: 'SCHEDULE_CANCELED' },
        });
      }
      return result;
    });
    if (changed.count !== 1) throw new AutomationError('Schedule not found.', 404);
    return { id: scheduleId, status: AutomationScheduleStatus.CANCELED };
  }

  async getNotificationPreferences(userId: string) {
    return prisma.automationNotificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async updateNotificationPreferences(
    userId: string,
    input: {
      failureNotifications: boolean;
      repeatedFailureThreshold: number;
      dailySummaryEnabled: boolean;
      dailySummaryTime: string;
      dailySummaryTimeZone: string;
    }
  ) {
    validateScheduleInput({
      frequency: AutomationScheduleFrequency.DAILY,
      timeZone: input.dailySummaryTimeZone,
      localTime: input.dailySummaryTime,
    });
    if (!Number.isInteger(input.repeatedFailureThreshold) ||
        input.repeatedFailureThreshold < 2 ||
        input.repeatedFailureThreshold > 10) {
      throw new AutomationError('Repeated failure threshold must be between 2 and 10.', 400);
    }
    return prisma.automationNotificationPreference.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });
  }
}
