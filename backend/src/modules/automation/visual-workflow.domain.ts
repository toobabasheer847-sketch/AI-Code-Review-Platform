import { z } from 'zod';
import {
  AUTOMATION_ACTIONS,
  automationActionInputSchemas,
  MAX_AUTOMATION_TASKS,
  orderAutomationTaskKeys,
  type PlannedTask,
  type ValidatedPlan,
} from './automation.domain';

const nodeIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);
const manualNodeSchema = z
  .object({
    id: nodeIdSchema,
    type: z.literal('manual'),
    label: z.string().trim().min(1).max(80),
  })
  .strict();
const actionNodeSchema = z
  .object({
    id: nodeIdSchema,
    type: z.literal('action'),
    title: z.string().trim().min(3).max(100),
    description: z.string().trim().min(3).max(500),
    action: z.enum([
      AUTOMATION_ACTIONS.COLLECT_REVIEW_RESULTS,
      AUTOMATION_ACTIONS.GENERATE_TEXT_DRAFT,
      AUTOMATION_ACTIONS.COLLECT_GITHUB_CONTEXT,
      AUTOMATION_ACTIONS.CREATE_GITHUB_ISSUE,
      AUTOMATION_ACTIONS.CREATE_GITHUB_PR_COMMENT,
    ]),
    input: z.unknown(),
  })
  .strict();
const conditionNodeSchema = z
  .object({
    id: nodeIdSchema,
    type: z.literal('condition'),
    title: z.string().trim().min(3).max(100),
    condition: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('review_count'),
          operator: z.enum(['gt', 'eq']),
          value: z.number().int().min(0).max(10_000),
        })
        .strict(),
      z
        .object({
          kind: z.literal('github_context_status'),
          equals: z.enum(['complete', 'partial']),
        })
        .strict(),
      z
        .object({
          kind: z.literal('github_write_status'),
          equals: z.enum(['created', 'already_created']),
        })
        .strict(),
    ]),
  })
  .strict();
const approvalNodeSchema = z
  .object({
    id: nodeIdSchema,
    type: z.literal('approval'),
    title: z.string().trim().min(3).max(100),
    message: z.string().trim().min(3).max(500),
  })
  .strict();
const terminalNodeSchema = z
  .object({
    id: nodeIdSchema,
    type: z.enum(['end', 'result']),
    title: z.string().trim().min(3).max(100),
    resultLabel: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const visualWorkflowNodeSchema = z.discriminatedUnion('type', [
  manualNodeSchema,
  actionNodeSchema,
  conditionNodeSchema,
  approvalNodeSchema,
  terminalNodeSchema,
]);

export const visualWorkflowSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    nodes: z.array(visualWorkflowNodeSchema).min(4).max(12),
    edges: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,80}$/),
            from: nodeIdSchema,
            to: nodeIdSchema,
            branch: z.enum(['true', 'false']).optional(),
          })
          .strict()
      )
      .min(3)
      .max(20),
  })
  .strict();

export type VisualWorkflowNode = z.infer<typeof visualWorkflowNodeSchema>;
export type VisualWorkflowDefinition = z.infer<typeof visualWorkflowSchema>;
export type VisualCondition = Extract<VisualWorkflowNode, { type: 'condition' }>['condition'];

export class VisualWorkflowValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join(' '));
    this.name = 'VisualWorkflowValidationError';
  }
}

function nearestActionAncestor(
  nodeId: string,
  parentById: Map<string, string>,
  nodesById: Map<string, VisualWorkflowNode>
): Extract<VisualWorkflowNode, { type: 'action' }> | null {
  let current = parentById.get(nodeId);
  while (current) {
    const node = nodesById.get(current);
    if (node?.type === 'action') return node;
    current = parentById.get(current);
  }
  return null;
}

function conditionMatchesAction(
  condition: VisualCondition,
  action: Extract<VisualWorkflowNode, { type: 'action' }>
): boolean {
  if (condition.kind === 'review_count') {
    return action.action === AUTOMATION_ACTIONS.COLLECT_REVIEW_RESULTS;
  }
  if (condition.kind === 'github_context_status') {
    return action.action === AUTOMATION_ACTIONS.COLLECT_GITHUB_CONTEXT;
  }
  return (
    action.action === AUTOMATION_ACTIONS.CREATE_GITHUB_ISSUE ||
    action.action === AUTOMATION_ACTIONS.CREATE_GITHUB_PR_COMMENT
  );
}

export function validateAndCompileVisualWorkflow(value: unknown): {
  workflow: VisualWorkflowDefinition;
  plan: ValidatedPlan;
} {
  const parsed = visualWorkflowSchema.safeParse(value);
  if (!parsed.success) {
    throw new VisualWorkflowValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'workflow'}: ${issue.message}`)
    );
  }
  const workflow = parsed.data;
  const errors: string[] = [];
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  if (nodesById.size !== workflow.nodes.length) errors.push('Node IDs must be unique.');
  const edgeIds = new Set(workflow.edges.map((edge) => edge.id));
  if (edgeIds.size !== workflow.edges.length) errors.push('Connection IDs must be unique.');

  const incoming = new Map(workflow.nodes.map((node) => [node.id, [] as string[]]));
  const outgoing = new Map(workflow.nodes.map((node) => [node.id, [] as typeof workflow.edges]));
  for (const edge of workflow.edges) {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) {
      errors.push(`Connection ${edge.id} refers to a missing node.`);
      continue;
    }
    if (edge.from === edge.to)
      errors.push(`Connection ${edge.id} cannot connect a node to itself.`);
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge);
    const source = nodesById.get(edge.from);
    if (source?.type === 'condition') {
      if (!edge.branch)
        errors.push(`Condition connection ${edge.id} must be labelled true or false.`);
    } else if (edge.branch) {
      errors.push(`Only condition nodes can label a connection with a branch.`);
    }
  }

  const triggers = workflow.nodes.filter((node) => node.type === 'manual');
  const approvals = workflow.nodes.filter((node) => node.type === 'approval');
  const actions = workflow.nodes.filter((node) => node.type === 'action');
  if (triggers.length !== 1) errors.push('A workflow must have exactly one manual trigger.');
  if (approvals.length !== 1) errors.push('A workflow must have exactly one approval node.');
  if (actions.length === 0 || actions.length > MAX_AUTOMATION_TASKS) {
    errors.push(`A workflow must have between 1 and ${MAX_AUTOMATION_TASKS} action nodes.`);
  }
  if (triggers.length === 1 && approvals.length === 1) {
    const trigger = triggers[0];
    const approval = approvals[0];
    if (
      incoming.get(approval.id)?.length !== 1 ||
      incoming.get(approval.id)?.[0] !== trigger.id ||
      outgoing.get(trigger.id)?.length !== 1 ||
      outgoing.get(trigger.id)?.[0]?.to !== approval.id
    ) {
      errors.push('The owner approval node must immediately follow the manual trigger.');
    }
  }

  for (const node of workflow.nodes) {
    const inCount = incoming.get(node.id)?.length ?? 0;
    const outEdges = outgoing.get(node.id) ?? [];
    if (node.type === 'manual') {
      if (inCount !== 0 || outEdges.length !== 1)
        errors.push('The manual trigger must be the single workflow entry.');
    } else if (inCount !== 1) {
      errors.push(
        `Node "${node.id}" must have exactly one incoming connection; merge paths are not supported.`
      );
    }
    if (node.type === 'condition') {
      const branches = outEdges.map((edge) => edge.branch);
      if (
        branches.length !== 2 ||
        new Set(branches).size !== 2 ||
        !branches.includes('true') ||
        !branches.includes('false')
      ) {
        errors.push(`Condition "${node.id}" must have exactly one true and one false connection.`);
      }
      const nearestAction = nearestActionAncestor(
        node.id,
        new Map(
          [...incoming].flatMap(([id, parents]) =>
            parents.length === 1 ? [[id, parents[0]] as const] : []
          )
        ),
        nodesById
      );
      if (!nearestAction || !conditionMatchesAction(node.condition, nearestAction)) {
        errors.push(`Condition "${node.id}" does not match its nearest preceding action result.`);
      }
    } else if (node.type === 'end' || node.type === 'result') {
      if (outEdges.length !== 0)
        errors.push(`Terminal node "${node.id}" cannot have outgoing connections.`);
    } else if (node.type !== 'manual' && outEdges.length !== 1) {
      errors.push(`Node "${node.id}" must have exactly one outgoing connection.`);
    }
    if (node.type === 'action') {
      const result = automationActionInputSchemas[node.action].safeParse(node.input);
      if (!result.success)
        errors.push(
          `Action "${node.id}" has invalid inputs: ${result.error.issues.map((issue) => issue.message).join(', ')}.`
        );
    }
  }

  if (workflow.edges.some((edge) => edge.from === edge.to)) {
    throw new VisualWorkflowValidationError(errors);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: VisualWorkflowNode[] = [];
  const visit = (nodeId: string): void => {
    const node = nodesById.get(nodeId);
    if (!node) return;
    if (visiting.has(nodeId)) {
      errors.push('Workflow connections cannot contain cycles.');
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    ordered.push(node);
    for (const edge of outgoing.get(nodeId) ?? []) visit(edge.to);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  if (triggers.length === 1) visit(triggers[0].id);
  if (visited.size !== workflow.nodes.length)
    errors.push('Every node must be reachable from the manual trigger.');
  if (!workflow.nodes.some((node) => node.type === 'end' || node.type === 'result')) {
    errors.push('Every workflow needs an end or result node.');
  }
  if (errors.length > 0) throw new VisualWorkflowValidationError([...new Set(errors)]);

  const parentById = new Map(
    [...incoming].flatMap(([id, parents]) =>
      parents.length === 1 ? [[id, parents[0]] as const] : []
    )
  );
  const tasks: PlannedTask[] = ordered.flatMap((node) => {
    if (node.type !== 'action') return [];
    const parentAction = nearestActionAncestor(node.id, parentById, nodesById);
    const task: PlannedTask = {
      key: node.id,
      title: node.title,
      description: node.description,
      action: node.action,
      input: automationActionInputSchemas[node.action].parse(node.input),
      dependsOn: parentAction ? [parentAction.id] : [],
    };
    return [task];
  });
  const taskOrder = orderAutomationTaskKeys(
    tasks.map((task) => ({ key: task.key, dependencies: task.dependsOn }))
  );
  const tasksByKey = new Map(tasks.map((task) => [task.key, task]));
  const plan: ValidatedPlan = {
    title: workflow.title,
    tasks: taskOrder.flatMap((key) => {
      const task = tasksByKey.get(key);
      return task ? [task] : [];
    }),
  };
  return { workflow, plan };
}

function nearestActionForExecution(
  nodeId: string,
  parentById: Map<string, string>,
  nodesById: Map<string, VisualWorkflowNode>
): Extract<VisualWorkflowNode, { type: 'action' }> | null {
  return nearestActionAncestor(nodeId, parentById, nodesById);
}

export function evaluateVisualCondition(
  condition: VisualCondition,
  sourceAction: Extract<VisualWorkflowNode, { type: 'action' }>,
  output: unknown
): boolean {
  if (
    condition.kind === 'review_count' &&
    sourceAction.action === AUTOMATION_ACTIONS.COLLECT_REVIEW_RESULTS
  ) {
    if (
      typeof output !== 'object' ||
      output === null ||
      !('reviews' in output) ||
      !Array.isArray(output.reviews)
    )
      return false;
    return condition.operator === 'gt'
      ? output.reviews.length > condition.value
      : output.reviews.length === condition.value;
  }
  if (
    condition.kind === 'github_context_status' &&
    sourceAction.action === AUTOMATION_ACTIONS.COLLECT_GITHUB_CONTEXT
  ) {
    if (typeof output !== 'object' || output === null || !('context' in output)) return false;
    const context = output.context;
    return (
      typeof context === 'object' &&
      context !== null &&
      'status' in context &&
      context.status === condition.equals
    );
  }
  if (
    condition.kind === 'github_write_status' &&
    (sourceAction.action === AUTOMATION_ACTIONS.CREATE_GITHUB_ISSUE ||
      sourceAction.action === AUTOMATION_ACTIONS.CREATE_GITHUB_PR_COMMENT)
  ) {
    return (
      typeof output === 'object' &&
      output !== null &&
      'status' in output &&
      output.status === condition.equals
    );
  }
  return false;
}

export function activeVisualActionIds(
  workflow: VisualWorkflowDefinition,
  outputs: Map<string, unknown>
): Set<string> {
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const parentById = new Map(workflow.edges.map((edge) => [edge.to, edge.from]));
  const outgoing = new Map(
    workflow.nodes.map((node) => [node.id, workflow.edges.filter((edge) => edge.from === node.id)])
  );
  const active = new Set<string>();
  const trigger = workflow.nodes.find((node) => node.type === 'manual');
  if (!trigger) return active;
  const visit = (node: VisualWorkflowNode): void => {
    if (node.type === 'action') active.add(node.id);
    const edges = outgoing.get(node.id) ?? [];
    if (node.type !== 'condition') {
      for (const edge of edges) {
        const next = nodesById.get(edge.to);
        if (next) visit(next);
      }
      return;
    }
    const source = nearestActionForExecution(node.id, parentById, nodesById);
    const matches =
      source !== null && evaluateVisualCondition(node.condition, source, outputs.get(source.id));
    const selected = edges.find((edge) => edge.branch === (matches ? 'true' : 'false'));
    const next = selected ? nodesById.get(selected.to) : undefined;
    if (next) visit(next);
  };
  visit(trigger);
  return active;
}
