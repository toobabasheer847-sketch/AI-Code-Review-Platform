import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  AutomationMode,
  AutomationStatus,
  AutomationTaskStatus,
  Prisma,
} from '@prisma/client';

export const MAX_AUTOMATION_GOAL_LENGTH = 2_000;
export const MAX_AUTOMATION_TASKS = 5;
export const MAX_ACTIVE_AUTOMATIONS_PER_USER = 5;
export const MAX_AUTOMATION_RETRIES = 3;
export const AUTOMATION_APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const AUTOMATION_ACTIONS = {
  COLLECT_REVIEW_RESULTS: 'collect_review_results',
  GENERATE_TEXT_DRAFT: 'generate_text_draft',
  COLLECT_GITHUB_CONTEXT: 'collect_github_context',
  CREATE_GITHUB_ISSUE: 'create_github_issue',
  CREATE_GITHUB_PR_COMMENT: 'create_github_pr_comment',
} as const;

const emptyActionInputSchema = z.object({}).strict();
const githubRepositoryInput = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .max(200);
const githubPullRequestNumberInput = z.number().int().positive().max(2_147_483_647);
const githubContextInputSchema = z
  .object({
    repository: githubRepositoryInput,
    pullRequestNumber: githubPullRequestNumberInput.optional(),
  })
  .strict();
const githubIssueInputSchema = z
  .object({
    repository: githubRepositoryInput,
    title: z.string().trim().min(1).max(256),
    body: z.string().trim().min(1).max(10_000),
  })
  .strict();
const githubPullRequestCommentInputSchema = z
  .object({
    repository: githubRepositoryInput,
    pullRequestNumber: githubPullRequestNumberInput,
    body: z.string().trim().min(1).max(10_000),
  })
  .strict();

export const automationActionInputSchemas = {
  [AUTOMATION_ACTIONS.COLLECT_REVIEW_RESULTS]: emptyActionInputSchema,
  [AUTOMATION_ACTIONS.GENERATE_TEXT_DRAFT]: emptyActionInputSchema,
  [AUTOMATION_ACTIONS.COLLECT_GITHUB_CONTEXT]: githubContextInputSchema,
  [AUTOMATION_ACTIONS.CREATE_GITHUB_ISSUE]: githubIssueInputSchema,
  [AUTOMATION_ACTIONS.CREATE_GITHUB_PR_COMMENT]: githubPullRequestCommentInputSchema,
} as const;

export const automationActionInputSchema = z.union([
  emptyActionInputSchema,
  githubContextInputSchema,
  githubIssueInputSchema,
  githubPullRequestCommentInputSchema,
]);

const taskSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9-]{1,40}$/),
    title: z.string().trim().min(3).max(100),
    description: z.string().trim().min(3).max(500),
    action: z.enum([
      AUTOMATION_ACTIONS.COLLECT_REVIEW_RESULTS,
      AUTOMATION_ACTIONS.GENERATE_TEXT_DRAFT,
      AUTOMATION_ACTIONS.COLLECT_GITHUB_CONTEXT,
      AUTOMATION_ACTIONS.CREATE_GITHUB_ISSUE,
      AUTOMATION_ACTIONS.CREATE_GITHUB_PR_COMMENT,
    ]),
    input: automationActionInputSchema.default({}),
    dependsOn: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(MAX_AUTOMATION_TASKS),
  })
  .strict();

export const planSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    tasks: z.array(taskSchema).min(1).max(MAX_AUTOMATION_TASKS),
  })
  .strict();

export type PlannedTask = z.infer<typeof taskSchema>;
export type ValidatedPlan = z.infer<typeof planSchema>;
export type AutomationModeValue = AutomationMode;
export type AutomationStatusValue = AutomationStatus;

export class AutomationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'AutomationError';
  }
}

export function orderAutomationTaskKeys(
  tasks: Array<{ key: string; dependencies: string[] }>
): string[] {
  const taskKeys = new Set(tasks.map((task) => task.key));
  if (taskKeys.size !== tasks.length) {
    throw new Error('Automation plan contains duplicate task keys');
  }

  const tasksByKey = new Map(tasks.map((task) => [task.key, task]));
  for (const task of tasks) {
    if (new Set(task.dependencies).size !== task.dependencies.length) {
      throw new Error('Automation task contains duplicate dependencies');
    }
    if (
      task.dependencies.some(
        (dependency) => !taskKeys.has(dependency) || dependency === task.key
      )
    ) {
      throw new Error('Automation plan contains an invalid task dependency');
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const orderedKeys: string[] = [];
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error('Automation plan contains a dependency cycle');
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of tasksByKey.get(key)?.dependencies ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
    orderedKeys.push(key);
  };
  for (const key of taskKeys) visit(key);

  return orderedKeys;
}

export function validatePlan(value: unknown): ValidatedPlan {
  const plan = planSchema.parse(value);
  for (const task of plan.tasks) {
    automationActionInputSchemas[task.action].parse(task.input);
  }
  const orderedKeys = orderAutomationTaskKeys(
    plan.tasks.map((task) => ({ key: task.key, dependencies: task.dependsOn }))
  );
  const tasksByKey = new Map(plan.tasks.map((task) => [task.key, task]));
  return {
    ...plan,
    tasks: orderedKeys.flatMap((key) => {
      const task = tasksByKey.get(key);
      return task ? [task] : [];
    }),
  };
}

const transitions: Record<AutomationStatusValue, readonly AutomationStatusValue[]> = {
  DRAFT: ['CANCELED'],
  AWAITING_APPROVAL: ['QUEUED', 'CANCELED', 'REJECTED'],
  QUEUED: ['RUNNING', 'FAILED', 'CANCELED'],
  RUNNING: ['COMPLETED', 'FAILED', 'CANCELED'],
  COMPLETED: [],
  FAILED: ['QUEUED', 'CANCELED'],
  CANCELED: [],
  REJECTED: [],
};

export function canTransitionAutomation(
  current: AutomationStatusValue,
  next: AutomationStatusValue
): boolean {
  return transitions[current].includes(next);
}

export function shouldExecuteAutomationTask(status: AutomationTaskStatus): boolean {
  return status === 'PENDING' || status === 'READY' || status === 'FAILED' || status === 'RUNNING';
}

export function areAutomationDependenciesCompleted(
  requiredKeys: string[],
  dependencies: Array<{ key: string; status: AutomationTaskStatus }>
): boolean {
  return (
    dependencies.length === requiredKeys.length &&
    requiredKeys.every((key) =>
      dependencies.some(
        (dependency) => dependency.key === key && dependency.status === 'COMPLETED'
      )
    )
  );
}

export function isAutomationTaskClaimable(input: {
  status: AutomationTaskStatus
  startedAt: Date | null
  now?: Date
  lockDurationMs?: number;
}): boolean {
  if (input.status === 'READY' || input.status === 'PENDING' || input.status === 'FAILED') {
    return true;
  }
  const staleBefore = (input.now ?? new Date()).getTime() - (input.lockDurationMs ?? 180_000);
  return (
    input.status === 'RUNNING' &&
    input.startedAt !== null &&
    input.startedAt.getTime() <= staleBefore
  );
}

export function canClaimAutomationTask(input: {
  status: AutomationTaskStatus;
  startedAt: Date | null;
  anotherTaskIsRunning: boolean;
  dependenciesCompleted: boolean;
  now?: Date;
}): boolean {
  return (
    !input.anotherTaskIsRunning &&
    input.dependenciesCompleted &&
    isAutomationTaskClaimable({
      status: input.status,
      startedAt: input.startedAt,
      now: input.now,
    })
  );
}

export function canRetryAutomation(
  status: AutomationStatusValue,
  retryCount: number
): boolean {
  return status === 'FAILED' && retryCount < MAX_AUTOMATION_RETRIES;
}

export function isFinalAutomationAttempt(attemptsMade: number, maxAttempts: number): boolean {
  return attemptsMade + 1 >= maxAttempts;
}

export interface ApprovalPayloadSource {
  goal: string;
  title: string;
  tasks: Array<{
    key: string;
    title: string;
    description: string;
    action: string;
    dependencies: string[];
    input: unknown;
  }>;
}

export function createApprovalPayload(source: ApprovalPayloadSource) {
  return {
    goal: source.goal,
    title: source.title,
    tasks: [...source.tasks]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((task) => ({
        key: task.key,
        title: task.title,
        description: task.description,
        action: task.action,
        dependencies: [...task.dependencies].sort(),
        input: task.input,
      })),
  };
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Approval payload is not JSON serializable');
  return serialized;
}

export function hashApprovalPayload(payload: unknown): string {
  return createHash('sha256').update(stableSerialize(payload)).digest('hex');
}

export function isApprovalPayloadIntact(
  payload: unknown,
  payloadHash: string,
  expectedPayload: ApprovalPayloadSource
): boolean {
  const expectedHash = hashApprovalPayload(createApprovalPayload(expectedPayload));
  return hashApprovalPayload(payload) === payloadHash && payloadHash === expectedHash;
}

export function isAutomationExecutionAuthorized(input: {
  mode: AutomationModeValue;
  userId: string;
  approval?: {
    userId: string;
    status: string;
    payload: unknown;
    payloadHash: string;
    expiresAt: Date;
    decidedAt: Date | null;
  } | null;
  plan: ApprovalPayloadSource;
}): boolean {
  if (
    input.mode === 'AUTO_LOW_RISK' &&
    input.plan.tasks.every(
      (task) =>
        task.action !== AUTOMATION_ACTIONS.CREATE_GITHUB_ISSUE &&
        task.action !== AUTOMATION_ACTIONS.CREATE_GITHUB_PR_COMMENT
    )
  ) {
    return true;
  }
  if (input.mode !== 'APPROVAL_REQUIRED' || !input.approval) return false;

  return (
    input.approval.userId === input.userId &&
    input.approval.status === 'APPROVED' &&
    input.approval.decidedAt !== null &&
    input.approval.decidedAt < input.approval.expiresAt &&
    isApprovalPayloadIntact(
      input.approval.payload,
      input.approval.payloadHash,
      input.plan
    )
  );
}

export function isApprovalUsable(input: {
  status: string;
  payloadHash: string;
  expectedPayloadHash: string;
  expiresAt: Date;
  now?: Date;
}): boolean {
  return (
    input.status === 'PENDING' &&
    input.payloadHash === input.expectedPayloadHash &&
    input.expiresAt.getTime() > (input.now ?? new Date()).getTime()
  );
}

export function ownedAutomationWhere(
  userId: string,
  automationId?: string
): Prisma.AutomationWhereInput {
  return automationId ? { userId, id: automationId } : { userId };
}
