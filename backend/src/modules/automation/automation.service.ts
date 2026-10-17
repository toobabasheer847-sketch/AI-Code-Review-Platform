import {
  AutomationMode,
  AutomationApprovalStatus,
  AutomationStatus,
  AutomationTaskStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/config/database';
import { automationJobId, automationQueue } from './automation.queue';
import { createAutomationPlan } from './automation.planner';
import { WorkMemoryService } from '@/modules/memory/memory.service';
import { GitHubService } from '@/modules/github/github.service';
import {
  validateAndCompileVisualWorkflow,
  type VisualWorkflowDefinition,
} from './visual-workflow.domain';
import {
  AutomationError,
  AUTOMATION_APPROVAL_TTL_MS,
  MAX_ACTIVE_AUTOMATIONS_PER_USER,
  MAX_AUTOMATION_RETRIES,
  canRetryAutomation,
  canTransitionAutomation,
  createApprovalPayload,
  hashApprovalPayload,
  isApprovalPayloadIntact,
  isApprovalUsable,
  ownedAutomationWhere,
  type AutomationModeValue,
  type ValidatedPlan,
} from './automation.domain';

const automationInclude = {
  tasks: {
    orderBy: [{ createdAt: 'asc' as const }, { key: 'asc' as const }],
    include: { executionAttempts: { orderBy: { createdAt: 'asc' as const } } },
  },
  events: { orderBy: { createdAt: 'asc' as const } },
  approvals: { orderBy: { createdAt: 'desc' as const }, take: 5 },
};

type AutomationRecord = Prisma.AutomationGetPayload<{ include: typeof automationInclude }>;

export class AutomationService {
  private readonly workMemory = new WorkMemoryService();

  async create(
    userId: string,
    input: {
      goal: string;
      mode: AutomationModeValue;
      idempotencyKey?: string;
      plan?: ValidatedPlan;
      workflowDefinition?: VisualWorkflowDefinition;
      scheduleId?: string;
      scheduledFor?: Date;
    }
  ): Promise<AutomationRecord> {
    if (input.idempotencyKey) {
      const previous = await prisma.automation.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
        include: automationInclude,
      });
      if (previous) {
        this.assertIdempotencyMatches(previous, input);
        return previous;
      }
    }

    const plan =
      input.plan ??
      (await createAutomationPlan(
        input.goal,
        undefined,
        await this.workMemory.contextForPlan(userId, input.goal)
      ));
    const approvalPayload = createApprovalPayload({
      goal: input.goal,
      title: plan.title,
      ...(input.workflowDefinition
        ? { workflowDefinition: input.workflowDefinition as Prisma.InputJsonValue }
        : {}),
      tasks: plan.tasks.map((task) => ({
        key: task.key,
        title: task.title,
        description: task.description,
        action: task.action,
        dependencies: task.dependsOn,
        input: task.input,
      })),
    });
    const initialStatus =
      input.mode === AutomationMode.DRAFT_ONLY
        ? AutomationStatus.DRAFT
        : input.mode === AutomationMode.APPROVAL_REQUIRED
          ? AutomationStatus.AWAITING_APPROVAL
          : AutomationStatus.QUEUED;

    let automation: AutomationRecord;
    try {
      automation = await prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
          const activeCount = await transaction.automation.count({
            where: {
              userId,
              status: {
                in: [
                  AutomationStatus.AWAITING_APPROVAL,
                  AutomationStatus.QUEUED,
                  AutomationStatus.RUNNING,
                ],
              },
            },
          });
          if (activeCount >= MAX_ACTIVE_AUTOMATIONS_PER_USER) {
            throw new AutomationError('Active automation limit reached.', 429);
          }

          return transaction.automation.create({
            data: {
              userId,
              goal: input.goal,
              title: plan.title,
              mode: input.mode,
              status: initialStatus,
              idempotencyKey: input.idempotencyKey,
              scheduleId: input.scheduleId,
              scheduledFor: input.scheduledFor,
              tasks: {
                create: plan.tasks.map((task) => ({
                  key: task.key,
                  title: task.title,
                  description: task.description,
                  action: task.action,
                  dependencies: task.dependsOn,
                  input: task.input,
                  status:
                    task.dependsOn.length > 0
                      ? AutomationTaskStatus.PENDING
                      : input.mode === AutomationMode.APPROVAL_REQUIRED
                        ? AutomationTaskStatus.AWAITING_APPROVAL
                        : input.mode === AutomationMode.AUTO_LOW_RISK
                          ? AutomationTaskStatus.READY
                          : AutomationTaskStatus.PENDING,
                })),
              },
              ...(input.mode === AutomationMode.APPROVAL_REQUIRED
                ? {
                    approvals: {
                      create: {
                        userId,
                        summary:
                          'Approve this internal workflow plan. It can read your completed code reviews and generate a draft, but cannot publish or modify external services.',
                        payload: approvalPayload as Prisma.InputJsonValue,
                        payloadHash: hashApprovalPayload(approvalPayload),
                        expiresAt: new Date(Date.now() + AUTOMATION_APPROVAL_TTL_MS),
                      },
                    },
                  }
                : {}),
              events: {
                create: {
                  type: 'created',
                  message: 'Automation plan created.',
                },
              },
            },
            include: automationInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (input.idempotencyKey && this.isUniqueConstraintError(error)) {
        const previous = await prisma.automation.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
          include: automationInclude,
        });
        if (previous) {
          this.assertIdempotencyMatches(previous, input);
          return previous;
        }
      }
      throw error;
    }

    if (input.mode === AutomationMode.AUTO_LOW_RISK) {
      await this.enqueue(automation.id, 0);
      return (await this.get(userId, automation.id)) ?? automation;
    }
    return automation;
  }

  async validateVisualWorkflow(
    userId: string,
    value: unknown
  ): Promise<{ valid: true; title: string; plan: ValidatedPlan }> {
    const { workflow, plan } = validateAndCompileVisualWorkflow(value);
    await this.authorizeVisualWorkflow(userId, workflow);
    return { valid: true, title: workflow.title, plan };
  }

  async saveVisualDraft(userId: string, goal: string, value: unknown): Promise<AutomationRecord> {
    const { workflow, plan } = validateAndCompileVisualWorkflow(value);
    await this.authorizeVisualWorkflow(userId, workflow);
    return this.create(userId, {
      goal,
      mode: AutomationMode.DRAFT_ONLY,
      plan,
      workflowDefinition: workflow,
    });
  }

  async executeVisualDraft(userId: string, automationId: string): Promise<AutomationRecord> {
    const automation = await this.getRequired(userId, automationId);
    if (
      automation.mode !== AutomationMode.DRAFT_ONLY ||
      automation.status !== AutomationStatus.DRAFT ||
      !automation.workflowDefinition
    ) {
      throw new AutomationError('Only a saved visual workflow draft can be executed.', 409);
    }
    const { workflow, plan } = validateAndCompileVisualWorkflow(automation.workflowDefinition);
    await this.authorizeVisualWorkflow(userId, workflow);
    const expectedPayload = createApprovalPayload({
      goal: automation.goal,
      title: plan.title,
      tasks: plan.tasks.map((task) => ({
        key: task.key,
        title: task.title,
        description: task.description,
        action: task.action,
        dependencies: task.dependsOn,
        input: task.input,
      })),
      workflowDefinition: workflow,
    });
    if (
      hashApprovalPayload(expectedPayload) !==
      hashApprovalPayload(createApprovalPayload(automation))
    ) {
      throw new AutomationError('The saved workflow no longer matches its executable graph.', 409);
    }
    const approvalNode = workflow.nodes.find(
      (node): node is Extract<VisualWorkflowDefinition['nodes'][number], { type: 'approval' }> =>
        node.type === 'approval'
    );

    await prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const activeCount = await transaction.automation.count({
          where: {
            userId,
            status: {
              in: [
                AutomationStatus.AWAITING_APPROVAL,
                AutomationStatus.QUEUED,
                AutomationStatus.RUNNING,
              ],
            },
          },
        });
        if (activeCount >= MAX_ACTIVE_AUTOMATIONS_PER_USER) {
          throw new AutomationError('Active automation limit reached.', 429);
        }
        const updated = await transaction.automation.updateMany({
          where: {
            id: automationId,
            userId,
            mode: AutomationMode.DRAFT_ONLY,
            status: AutomationStatus.DRAFT,
          },
          data: {
            mode: AutomationMode.APPROVAL_REQUIRED,
            status: AutomationStatus.AWAITING_APPROVAL,
          },
        });
        if (updated.count !== 1)
          throw new AutomationError('Workflow state changed; refresh and retry.', 409);
        const tasks = await transaction.automationTask.updateMany({
          where: { automationId, status: AutomationTaskStatus.PENDING },
          data: { status: AutomationTaskStatus.AWAITING_APPROVAL },
        });
        if (tasks.count !== plan.tasks.length) {
          throw new AutomationError('The saved workflow task set is incomplete.', 409);
        }
        await transaction.automationApproval.create({
          data: {
            automationId,
            userId,
            summary:
              approvalNode?.message ?? 'Approve this visual workflow before its actions run.',
            payload: expectedPayload as Prisma.InputJsonValue,
            payloadHash: hashApprovalPayload(expectedPayload),
            expiresAt: new Date(Date.now() + AUTOMATION_APPROVAL_TTL_MS),
          },
        });
        await transaction.automationEvent.create({
          data: {
            automationId,
            type: 'approval_requested',
            message: 'Visual workflow submitted for owner approval.',
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    return this.getRequired(userId, automationId);
  }

  async list(userId: string): Promise<AutomationRecord[]> {
    await this.expirePendingApprovals(userId);
    return prisma.automation.findMany({
      where: ownedAutomationWhere(userId),
      include: automationInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async get(userId: string, automationId: string): Promise<AutomationRecord | null> {
    await this.expirePendingApprovals(userId, automationId);
    return prisma.automation.findFirst({
      where: ownedAutomationWhere(userId, automationId),
      include: automationInclude,
    });
  }

  async approve(userId: string, automationId: string): Promise<AutomationRecord> {
    const automation = await this.getRequired(userId, automationId);
    if (
      automation.mode !== AutomationMode.APPROVAL_REQUIRED ||
      automation.status !== AutomationStatus.AWAITING_APPROVAL
    ) {
      throw new AutomationError('This automation is not awaiting approval.', 409);
    }
    const currentPayload = createApprovalPayload(automation);
    const currentPayloadHash = hashApprovalPayload(currentPayload);
    let invalidApproval: 'expired' | 'changed' | null = null;
    await prisma.$transaction(async (transaction) => {
      const approval = await transaction.automationApproval.findFirst({
        where: {
          automationId,
          userId,
          status: AutomationApprovalStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!approval) {
        throw new AutomationError('No pending approval exists for this automation.', 409);
      }

      const matchesCurrentPlan = isApprovalPayloadIntact(
        approval.payload,
        approval.payloadHash,
        currentPayload
      );
      const usable =
        isApprovalUsable({
          status: approval.status,
          payloadHash: approval.payloadHash,
          expectedPayloadHash: currentPayloadHash,
          expiresAt: approval.expiresAt,
        }) && matchesCurrentPlan;
      if (!usable) {
        invalidApproval = approval.expiresAt.getTime() <= Date.now() ? 'expired' : 'changed';
        await transaction.automationApproval.updateMany({
          where: { id: approval.id, userId, status: AutomationApprovalStatus.PENDING },
          data: {
            status: AutomationApprovalStatus.EXPIRED,
            decidedAt: new Date(),
          },
        });
        await transaction.automation.updateMany({
          where: {
            id: automationId,
            userId,
            status: AutomationStatus.AWAITING_APPROVAL,
          },
          data: { status: AutomationStatus.CANCELED },
        });
        await transaction.automationTask.updateMany({
          where: {
            automationId,
            status: {
              in: [
                AutomationTaskStatus.PENDING,
                AutomationTaskStatus.AWAITING_APPROVAL,
                AutomationTaskStatus.READY,
              ],
            },
          },
          data: { status: AutomationTaskStatus.CANCELED },
        });
        await transaction.automationEvent.create({
          data: {
            automationId,
            type: invalidApproval === 'expired' ? 'approval_expired' : 'approval_stale',
            message:
              invalidApproval === 'expired'
                ? 'The approval request expired before a decision was recorded.'
                : 'The plan changed after approval was requested; a new plan is required.',
          },
        });
        return;
      }

      const approvalUpdate = await transaction.automationApproval.updateMany({
        where: {
          id: approval.id,
          userId,
          status: AutomationApprovalStatus.PENDING,
          payloadHash: currentPayloadHash,
          expiresAt: { gt: new Date() },
        },
        data: { status: AutomationApprovalStatus.APPROVED, decidedAt: new Date() },
      });
      const automationUpdate = await transaction.automation.updateMany({
        where: {
          id: automationId,
          userId,
          status: AutomationStatus.AWAITING_APPROVAL,
        },
        data: { status: AutomationStatus.QUEUED },
      });
      if (approvalUpdate.count !== 1 || automationUpdate.count !== 1) {
        throw new AutomationError('Approval state changed; refresh and retry.', 409);
      }
      const readyTasks = await transaction.automationTask.updateMany({
        where: {
          automationId,
          status: AutomationTaskStatus.AWAITING_APPROVAL,
        },
        data: { status: AutomationTaskStatus.READY },
      });
      if (readyTasks.count === 0) {
        throw new AutomationError('No executable tasks remain in this workflow.', 409);
      }
      await transaction.automationEvent.create({
        data: {
          automationId,
          type: 'approved',
          message: 'The owner approved the unchanged workflow plan.',
        },
      });
    });
    if (invalidApproval) {
      throw new AutomationError(
        invalidApproval === 'expired'
          ? 'This approval request has expired.'
          : 'The plan changed after approval was requested. Create a new plan to continue.',
        409
      );
    }
    await this.enqueue(automationId, automation.retryCount);
    return this.getRequired(userId, automationId);
  }

  async reject(userId: string, automationId: string): Promise<AutomationRecord> {
    const automation = await this.getRequired(userId, automationId);
    if (automation.status !== AutomationStatus.AWAITING_APPROVAL) {
      throw new AutomationError('This automation is not awaiting approval.', 409);
    }
    const now = new Date();
    const result = await prisma.$transaction(async (transaction) => {
      const approval = await transaction.automationApproval.findFirst({
        where: {
          automationId,
          userId,
          status: AutomationApprovalStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!approval)
        throw new AutomationError('No pending approval exists for this automation.', 409);
      if (approval.expiresAt <= now) {
        await transaction.automationApproval.updateMany({
          where: { id: approval.id, userId, status: AutomationApprovalStatus.PENDING },
          data: { status: AutomationApprovalStatus.EXPIRED, decidedAt: now },
        });
        await transaction.automation.updateMany({
          where: { id: automationId, userId, status: AutomationStatus.AWAITING_APPROVAL },
          data: { status: AutomationStatus.CANCELED },
        });
        await transaction.automationTask.updateMany({
          where: {
            automationId,
            status: {
              in: [
                AutomationTaskStatus.PENDING,
                AutomationTaskStatus.AWAITING_APPROVAL,
                AutomationTaskStatus.READY,
              ],
            },
          },
          data: { status: AutomationTaskStatus.CANCELED },
        });
        await transaction.automationEvent.create({
          data: {
            automationId,
            type: 'approval_expired',
            message: 'The approval request expired before a decision was recorded.',
          },
        });
        return false;
      }

      const approvalUpdate = await transaction.automationApproval.updateMany({
        where: { id: approval.id, userId, status: AutomationApprovalStatus.PENDING },
        data: { status: AutomationApprovalStatus.REJECTED, decidedAt: now },
      });
      const automationUpdate = await transaction.automation.updateMany({
        where: { id: automationId, userId, status: AutomationStatus.AWAITING_APPROVAL },
        data: { status: AutomationStatus.REJECTED },
      });
      if (approvalUpdate.count !== 1 || automationUpdate.count !== 1) {
        throw new AutomationError('Approval state changed; refresh and retry.', 409);
      }
      await transaction.automationTask.updateMany({
        where: {
          automationId,
          status: {
            in: [
              AutomationTaskStatus.PENDING,
              AutomationTaskStatus.AWAITING_APPROVAL,
              AutomationTaskStatus.READY,
            ],
          },
        },
        data: { status: AutomationTaskStatus.CANCELED },
      });
      await transaction.automationEvent.create({
        data: {
          automationId,
          type: 'rejected',
          message: 'The owner rejected the workflow plan; no tasks were executed.',
        },
      });
      return true;
    });
    if (!result) throw new AutomationError('This approval request has expired.', 409);
    return this.getRequired(userId, automationId);
  }

  async cancel(userId: string, automationId: string): Promise<AutomationRecord> {
    const automation = await this.getRequired(userId, automationId);
    if (!canTransitionAutomation(automation.status, AutomationStatus.CANCELED)) {
      throw new AutomationError('This automation cannot be canceled in its current state.', 409);
    }
    await prisma.$transaction(async (transaction) => {
      const result = await transaction.automation.updateMany({
        where: {
          id: automationId,
          userId,
          status: automation.status,
        },
        data: { status: AutomationStatus.CANCELED },
      });
      if (result.count !== 1)
        throw new AutomationError('Automation state changed; refresh and retry.', 409);
      await transaction.automationTask.updateMany({
        where: {
          automationId,
          status: {
            in: [
              AutomationTaskStatus.PENDING,
              AutomationTaskStatus.AWAITING_APPROVAL,
              AutomationTaskStatus.READY,
              AutomationTaskStatus.RUNNING,
            ],
          },
        },
        data: { status: AutomationTaskStatus.CANCELED },
      });
      await transaction.automationExecutionAttempt.updateMany({
        where: {
          task: { automationId },
          status: 'RUNNING',
        },
        data: { status: 'CANCELED', completedAt: new Date() },
      });
      await transaction.automationApproval.updateMany({
        where: { automationId, userId, status: AutomationApprovalStatus.PENDING },
        data: { status: AutomationApprovalStatus.CANCELED, decidedAt: new Date() },
      });
      await transaction.automationEvent.create({
        data: { automationId, type: 'canceled', message: 'Automation canceled by the owner.' },
      });
    });
    return this.getRequired(userId, automationId);
  }

  async retry(userId: string, automationId: string): Promise<AutomationRecord> {
    const automation = await this.getRequired(userId, automationId);
    if (!canRetryAutomation(automation.status, automation.retryCount)) {
      if (
        automation.status === AutomationStatus.FAILED &&
        automation.retryCount >= MAX_AUTOMATION_RETRIES
      ) {
        throw new AutomationError(
          'The maximum number of automation retries has been reached.',
          409
        );
      }
      throw new AutomationError('Only failed automations can be retried.', 409);
    }
    const retryCount = automation.retryCount + 1;
    await prisma.$transaction(async (transaction) => {
      const result = await transaction.automation.updateMany({
        where: { id: automationId, userId, status: AutomationStatus.FAILED },
        data: { status: AutomationStatus.QUEUED, retryCount },
      });
      if (result.count !== 1)
        throw new AutomationError('Automation state changed; refresh and retry.', 409);
      await transaction.automationTask.updateMany({
        where: { automationId, status: AutomationTaskStatus.FAILED },
        data: { status: AutomationTaskStatus.PENDING, errorMessage: null },
      });
      await transaction.automationEvent.create({
        data: { automationId, type: 'retry', message: 'Automation retry queued.' },
      });
    });
    await this.enqueue(automationId, retryCount);
    return this.getRequired(userId, automationId);
  }

  private async getRequired(userId: string, automationId: string): Promise<AutomationRecord> {
    const automation = await this.get(userId, automationId);
    if (!automation) throw new AutomationError('Automation not found.', 404);
    return automation;
  }

  private async authorizeVisualWorkflow(
    userId: string,
    workflow: VisualWorkflowDefinition
  ): Promise<void> {
    const github = new GitHubService();
    for (const node of workflow.nodes) {
      if (
        node.type !== 'action' ||
        (node.action !== 'collect_github_context' &&
          node.action !== 'create_github_issue' &&
          node.action !== 'create_github_pr_comment')
      ) {
        continue;
      }
      const input = node.input as { repository: string };
      try {
        await github.validateDevelopmentRepository(
          userId,
          input.repository,
          node.action === 'create_github_issue' || node.action === 'create_github_pr_comment'
        );
      } catch (error) {
        if (error instanceof Error) throw new AutomationError(error.message, 403);
        throw error;
      }
    }
  }

  private assertIdempotencyMatches(
    previous: AutomationRecord,
    input: { goal: string; mode: AutomationModeValue; plan?: ValidatedPlan }
  ): void {
    if (
      previous.goal !== input.goal ||
      previous.mode !== input.mode ||
      (input.plan !== undefined &&
        hashApprovalPayload(createApprovalPayload(previous)) !==
          hashApprovalPayload(
            createApprovalPayload({
              goal: input.goal,
              title: input.plan.title,
              tasks: input.plan.tasks.map((task) => ({
                key: task.key,
                title: task.title,
                description: task.description,
                action: task.action,
                dependencies: task.dependsOn,
                input: task.input,
              })),
            })
          ))
    ) {
      throw new AutomationError('Idempotency-Key was already used for a different workflow.', 409);
    }
  }

  private async expirePendingApprovals(userId: string, automationId?: string): Promise<void> {
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      const expired = await transaction.automationApproval.findMany({
        where: {
          userId,
          status: AutomationApprovalStatus.PENDING,
          expiresAt: { lte: now },
          ...(automationId ? { automationId } : {}),
        },
        select: { id: true, automationId: true },
      });
      if (expired.length === 0) return;

      await transaction.automationApproval.updateMany({
        where: {
          id: { in: expired.map((approval) => approval.id) },
          status: AutomationApprovalStatus.PENDING,
        },
        data: { status: AutomationApprovalStatus.EXPIRED, decidedAt: now },
      });
      for (const id of new Set(expired.map((approval) => approval.automationId))) {
        const updated = await transaction.automation.updateMany({
          where: { id, userId, status: AutomationStatus.AWAITING_APPROVAL },
          data: { status: AutomationStatus.CANCELED },
        });
        if (updated.count === 0) continue;
        await transaction.automationTask.updateMany({
          where: {
            automationId: id,
            status: {
              in: [
                AutomationTaskStatus.PENDING,
                AutomationTaskStatus.AWAITING_APPROVAL,
                AutomationTaskStatus.READY,
              ],
            },
          },
          data: { status: AutomationTaskStatus.CANCELED },
        });
        await transaction.automationEvent.create({
          data: {
            automationId: id,
            type: 'approval_expired',
            message: 'The approval request expired before a decision was recorded.',
          },
        });
      }
    });
  }

  private async enqueue(automationId: string, retryCount: number): Promise<void> {
    try {
      await automationQueue.add(
        'execute',
        { automationId },
        { jobId: automationJobId(automationId, retryCount) }
      );
    } catch {
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
            type: 'queue_error',
            message: 'Automation could not be added to the execution queue.',
          },
        });
      });
      throw new AutomationError('Unable to queue automation. Please retry.', 503);
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
