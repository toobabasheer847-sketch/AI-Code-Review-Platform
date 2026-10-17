import {
  AutomationAttemptStatus,
  AutomationStatus,
  AutomationTaskStatus,
  Prisma,
} from '@prisma/client';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@/config/env';
import { prisma } from '@/config/database';
import logger from '@/utils/logger';
import { AutomationActionRegistry } from './automation.actions';
import type { AutomationJobData } from './automation.queue';
import {
  areAutomationDependenciesCompleted,
  canClaimAutomationTask,
  createApprovalPayload,
  isAutomationExecutionAuthorized,
  isFinalAutomationAttempt,
  orderAutomationTaskKeys,
  shouldExecuteAutomationTask,
} from './automation.domain';
import {
  activeVisualActionIds,
  VisualWorkflowValidationError,
  validateAndCompileVisualWorkflow,
  type VisualWorkflowDefinition,
} from './visual-workflow.domain';

let worker: Worker<AutomationJobData> | null = null;

async function processAutomation(job: Job<AutomationJobData>): Promise<void> {
  const { automationId } = job.data;
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    include: {
      tasks: { orderBy: { createdAt: 'asc' } },
      approvals: {
        where: { status: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
  if (
    !automation ||
    automation.status === AutomationStatus.CANCELED ||
    automation.status === AutomationStatus.REJECTED ||
    automation.status === AutomationStatus.COMPLETED
  ) {
    return;
  }
  let visualWorkflow: VisualWorkflowDefinition | null = null;
  if (automation.workflowDefinition !== null) {
    try {
      visualWorkflow = validateAndCompileVisualWorkflow(automation.workflowDefinition).workflow;
    } catch (error) {
      if (!(error instanceof VisualWorkflowValidationError)) throw error;
      await prisma.$transaction(async (transaction) => {
        await transaction.automation.updateMany({
          where: {
            id: automationId,
            status: { in: [AutomationStatus.QUEUED, AutomationStatus.RUNNING] },
          },
          data: { status: AutomationStatus.FAILED },
        });
        await transaction.automationEvent.create({
          data: {
            automationId,
            type: 'workflow_validation_failed',
            message: 'Visual workflow validation failed before execution.',
          },
        });
      });
      return;
    }
  }
  if (
    !isAutomationExecutionAuthorized({
      mode: automation.mode,
      userId: automation.userId,
      approval: automation.approvals[0],
      plan: createApprovalPayload(automation),
    })
  ) {
    await prisma.$transaction(async (transaction) => {
      const result = await transaction.automation.updateMany({
        where: {
          id: automationId,
          status: { in: [AutomationStatus.QUEUED, AutomationStatus.RUNNING] },
        },
        data: { status: AutomationStatus.FAILED },
      });
      if (result.count > 0) {
        await transaction.automationEvent.create({
          data: {
            automationId,
            type: 'authorization_failed',
            message:
              'Automation execution was blocked because its server-side authorization was invalid.',
          },
        });
      }
    });
    return;
  }
  const tasksByKey = new Map(automation.tasks.map((task) => [task.key, task]));
  const orderedTasks = orderAutomationTaskKeys(
    automation.tasks.map((task) => ({ key: task.key, dependencies: task.dependencies }))
  ).flatMap((key) => {
    const task = tasksByKey.get(key);
    return task ? [task] : [];
  });

  const started = await prisma.$transaction(async (transaction) => {
    const result = await transaction.automation.updateMany({
      where: {
        id: automationId,
        status: { in: [AutomationStatus.QUEUED, AutomationStatus.RUNNING] },
      },
      data: { status: AutomationStatus.RUNNING },
    });
    if (result.count === 0) return false;
    await transaction.automationEvent.create({
      data: { automationId, type: 'started', message: 'Automation execution started.' },
    });
    return true;
  });
  if (!started) return;

  const actions = new AutomationActionRegistry();
  const visualOutputs = new Map<string, unknown>(
    automation.tasks
      .filter((task) => task.status === AutomationTaskStatus.COMPLETED && task.output !== null)
      .map((task) => [task.key, task.output])
  );
  for (const task of orderedTasks) {
    const current = await prisma.automation.findUnique({
      where: { id: automationId },
      select: { status: true },
    });
    if (
      !current ||
      current.status === AutomationStatus.CANCELED ||
      current.status === AutomationStatus.REJECTED
    )
      return;
    if (visualWorkflow) {
      const activeNodes = activeVisualActionIds(visualWorkflow, visualOutputs);
      if (!activeNodes.has(task.key)) {
        if (
          task.status !== AutomationTaskStatus.SKIPPED &&
          task.status !== AutomationTaskStatus.COMPLETED
        ) {
          await prisma.$transaction(async (transaction) => {
            const result = await transaction.automationTask.updateMany({
              where: {
                id: task.id,
                status: {
                  in: [
                    AutomationTaskStatus.PENDING,
                    AutomationTaskStatus.AWAITING_APPROVAL,
                    AutomationTaskStatus.READY,
                    AutomationTaskStatus.SKIPPED,
                  ],
                },
              },
              data: { status: AutomationTaskStatus.SKIPPED },
            });
            if (result.count > 0) {
              await transaction.automationEvent.create({
                data: {
                  automationId,
                  type: 'branch_skipped',
                  message: 'A task was skipped because its condition selected another branch.',
                },
              });
            }
          });
        }
        continue;
      }
      if (task.status === AutomationTaskStatus.SKIPPED) {
        await prisma.automationTask.updateMany({
          where: { id: task.id, status: AutomationTaskStatus.SKIPPED },
          data: { status: AutomationTaskStatus.PENDING },
        });
      }
    }
    if (!shouldExecuteAutomationTask(task.status) && task.status !== AutomationTaskStatus.SKIPPED) {
      continue;
    }

    let attemptNumber = 0;
    try {
      const claim = await prisma.$transaction(async (transaction) => {
        const [state] = await transaction.$queryRaw<Array<{ status: AutomationStatus }>>`
          SELECT "status" FROM "Automation" WHERE "id" = ${automationId} FOR UPDATE
        `;
        if (!state || state.status !== AutomationStatus.RUNNING) return false;
        const currentTask = await transaction.automationTask.findUnique({
          where: { id: task.id },
          select: { status: true, startedAt: true },
        });
        if (!currentTask) return false;
        const dependencies = await transaction.automationTask.findMany({
          where: { automationId, key: { in: task.dependencies } },
          select: { key: true, status: true, output: true },
        });
        const anotherRunningTask = await transaction.automationTask.findFirst({
          where: {
            automationId,
            id: { not: task.id },
            status: AutomationTaskStatus.RUNNING,
          },
          select: { id: true },
        });
        if (
          !canClaimAutomationTask({
            status: currentTask.status,
            startedAt: currentTask.startedAt,
            anotherTaskIsRunning: anotherRunningTask !== null,
            dependenciesCompleted: areAutomationDependenciesCompleted(
              task.dependencies,
              dependencies
            ),
          })
        ) {
          return false;
        }
        const staleRunningTask = currentTask.status === AutomationTaskStatus.RUNNING;
        if (staleRunningTask) {
          await transaction.automationExecutionAttempt.updateMany({
            where: { taskId: task.id, status: AutomationAttemptStatus.RUNNING },
            data: {
              status: AutomationAttemptStatus.FAILED,
              errorMessage: 'Worker stopped before the attempt result was saved.',
              completedAt: new Date(),
            },
          });
        }
        const taskUpdate = await transaction.automationTask.updateMany({
          where: { id: task.id, status: currentTask.status },
          data: {
            status: AutomationTaskStatus.RUNNING,
            attempts: { increment: 1 },
            startedAt: new Date(),
            errorMessage: null,
          },
        });
        if (taskUpdate.count !== 1) return false;
        const claimedTask = await transaction.automationTask.findUnique({
          where: { id: task.id },
          select: { attempts: true },
        });
        if (!claimedTask) throw new Error('Claimed automation task could not be reloaded');
        attemptNumber = claimedTask.attempts;
        await transaction.automationExecutionAttempt.create({
          data: {
            taskId: task.id,
            attemptNumber,
            status: AutomationAttemptStatus.RUNNING,
          },
        });
        await transaction.automationEvent.create({
          data: { automationId, type: 'task_started', message: 'An automation task started.' },
        });
        return dependencies;
      });
      if (!claim) continue;

      const output = await actions.execute(task.action, {
        userId: automation.userId,
        goal: automation.goal,
        title: task.title,
        description: task.description,
        actionInput: task.input,
        taskId: task.id,
        dependencyOutputs: claim.map(({ key, output: dependencyOutput }) => ({
          key,
          output: dependencyOutput,
        })),
      });
      visualOutputs.set(task.key, output);

      const persisted = await prisma.$transaction(async (transaction) => {
        const [state] = await transaction.$queryRaw<Array<{ status: AutomationStatus }>>`
          SELECT "status" FROM "Automation" WHERE "id" = ${automationId} FOR UPDATE
        `;
        if (!state || state.status !== AutomationStatus.RUNNING) return false;
        const taskUpdate = await transaction.automationTask.updateMany({
          where: { id: task.id, status: AutomationTaskStatus.RUNNING },
          data: {
            status: AutomationTaskStatus.COMPLETED,
            output: output as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });
        if (taskUpdate.count !== 1) return false;
        const attemptUpdate = await transaction.automationExecutionAttempt.updateMany({
          where: {
            taskId: task.id,
            attemptNumber,
            status: AutomationAttemptStatus.RUNNING,
          },
          data: {
            status: AutomationAttemptStatus.COMPLETED,
            output: output as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });
        if (attemptUpdate.count !== 1) {
          throw new Error('Automation execution attempt could not be completed');
        }
        await transaction.automationEvent.create({
          data: { automationId, type: 'task_completed', message: 'An automation task completed.' },
        });
        return true;
      });
      if (!persisted) return;
    } catch {
      const finalAttempt = isFinalAutomationAttempt(job.attemptsMade, job.opts.attempts ?? 1);
      const safeErrorMessage = 'Automation task failed. You can retry this automation.';
      const persisted = await prisma.$transaction(async (transaction) => {
        const [state] = await transaction.$queryRaw<Array<{ status: AutomationStatus }>>`
          SELECT "status" FROM "Automation" WHERE "id" = ${automationId} FOR UPDATE
        `;
        if (!state || state.status !== AutomationStatus.RUNNING) return false;
        const taskUpdate = await transaction.automationTask.updateMany({
          where: { id: task.id, status: AutomationTaskStatus.RUNNING },
          data: { status: AutomationTaskStatus.FAILED, errorMessage: safeErrorMessage },
        });
        if (taskUpdate.count !== 1) return false;
        if (attemptNumber > 0) {
          const attemptUpdate = await transaction.automationExecutionAttempt.updateMany({
            where: {
              taskId: task.id,
              attemptNumber,
              status: AutomationAttemptStatus.RUNNING,
            },
            data: {
              status: AutomationAttemptStatus.FAILED,
              errorMessage: safeErrorMessage,
              completedAt: new Date(),
            },
          });
          if (attemptUpdate.count !== 1) {
            throw new Error('Automation execution failure could not be recorded');
          }
        }
        if (finalAttempt) {
          await transaction.automation.updateMany({
            where: { id: automationId, status: AutomationStatus.RUNNING },
            data: { status: AutomationStatus.FAILED },
          });
        }
        await transaction.automationEvent.create({
          data: {
            automationId,
            type: 'task_failed',
            message: 'An automation task failed. Retry is available after the job stops retrying.',
          },
        });
        return true;
      });
      if (!persisted) {
        const current = await prisma.automation.findUnique({
          where: { id: automationId },
          select: { status: true },
        });
        if (
          current?.status === AutomationStatus.CANCELED ||
          current?.status === AutomationStatus.REJECTED
        ) {
          return;
        }
        throw new Error('Automation task failure could not be persisted');
      }
      throw new Error('Automation task execution failed');
    }
  }

  await prisma.$transaction(async (transaction) => {
    const unfinishedTasks = await transaction.automationTask.count({
      where: {
        automationId,
        status: {
          in: [
            AutomationTaskStatus.PENDING,
            AutomationTaskStatus.AWAITING_APPROVAL,
            AutomationTaskStatus.READY,
            AutomationTaskStatus.RUNNING,
            AutomationTaskStatus.FAILED,
          ],
        },
      },
    });
    if (unfinishedTasks > 0) return;
    const result = await transaction.automation.updateMany({
      where: { id: automationId, status: AutomationStatus.RUNNING },
      data: { status: AutomationStatus.COMPLETED },
    });
    if (result.count > 0) {
      await transaction.automationTask.updateMany({
        where: {
          automationId: job.data.automationId,
          status: AutomationTaskStatus.RUNNING,
        },
        data: {
          status: AutomationTaskStatus.FAILED,
          errorMessage: 'Automation task failed. You can retry this automation.',
        },
      });
      await transaction.automationExecutionAttempt.updateMany({
        where: {
          task: { automationId: job.data.automationId },
          status: AutomationAttemptStatus.RUNNING,
        },
        data: {
          status: AutomationAttemptStatus.FAILED,
          errorMessage: 'Automation task failed. You can retry this automation.',
          completedAt: new Date(),
        },
      });
      await transaction.automationEvent.create({
        data: { automationId, type: 'completed', message: 'Automation completed.' },
      });
    }
  });
}

export async function startAutomationWorker(): Promise<void> {
  if (worker) return;
  worker = new Worker<AutomationJobData>('automation', async (job) => processAutomation(job), {
    connection: new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }),
    concurrency: 2,
    lockDuration: 180_000,
  });
  worker.on('failed', (job, error) => {
    logger.error(
      { automationId: job?.data.automationId, errorType: error.name },
      'Automation job attempt failed'
    );
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void prisma
        .$transaction(async (transaction) => {
          const result = await transaction.automation.updateMany({
            where: {
              id: job.data.automationId,
              status: { in: [AutomationStatus.QUEUED, AutomationStatus.RUNNING] },
            },
            data: { status: AutomationStatus.FAILED },
          });
          if (result.count > 0) {
            await transaction.automationEvent.create({
              data: {
                automationId: job.data.automationId,
                type: 'failed',
                message: 'Automation failed after the allowed retry attempts.',
              },
            });
          }
        })
        .catch((failure: unknown) => {
          logger.error(
            {
              automationId: job.data.automationId,
              errorType: failure instanceof Error ? failure.name : 'UnknownError',
            },
            'Failed to persist terminal automation job failure'
          );
        });
    }
  });
  await worker.waitUntilReady();
}

export async function stopAutomationWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

export const automationWorkerInternals = { processAutomation };
