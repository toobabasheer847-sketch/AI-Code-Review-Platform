import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createApprovalPayload,
  hashApprovalPayload,
  isAutomationExecutionAuthorized,
} from './automation.domain';
import {
  activeVisualActionIds,
  evaluateVisualCondition,
  validateAndCompileVisualWorkflow,
  VisualWorkflowValidationError,
  type VisualWorkflowDefinition,
} from './visual-workflow.domain';

const validWorkflow: VisualWorkflowDefinition = {
  title: 'Review project and prepare an update',
  nodes: [
    { id: 'manual', type: 'manual', label: 'Start manually' },
    {
      id: 'approval',
      type: 'approval',
      title: 'Owner approval',
      message: 'Approve before queueing.',
    },
    {
      id: 'read-reviews',
      type: 'action',
      title: 'Collect reviews',
      description: 'Read completed code review results.',
      action: 'collect_review_results',
      input: {},
    },
    {
      id: 'has-reviews',
      type: 'condition',
      title: 'Check review count',
      condition: { kind: 'review_count', operator: 'gt', value: 0 },
    },
    {
      id: 'draft',
      type: 'action',
      title: 'Write an internal update',
      description: 'Draft an update from completed review data.',
      action: 'generate_text_draft',
      input: {},
    },
    { id: 'empty', type: 'end', title: 'No review results' },
    { id: 'result', type: 'result', title: 'Draft ready', resultLabel: 'Review before sharing' },
  ],
  edges: [
    { id: 'e-manual-approval', from: 'manual', to: 'approval' },
    { id: 'e-approval-read', from: 'approval', to: 'read-reviews' },
    { id: 'e-read-condition', from: 'read-reviews', to: 'has-reviews' },
    { id: 'e-condition-draft', from: 'has-reviews', to: 'draft', branch: 'true' },
    { id: 'e-condition-empty', from: 'has-reviews', to: 'empty', branch: 'false' },
    { id: 'e-draft-result', from: 'draft', to: 'result' },
  ],
};

test('valid manual-triggered visual workflow compiles to existing actions and task dependencies', () => {
  const result = validateAndCompileVisualWorkflow(validWorkflow);
  assert.equal(result.plan.title, validWorkflow.title);
  assert.deepEqual(
    result.plan.tasks.map((task) => ({
      key: task.key,
      action: task.action,
      dependsOn: task.dependsOn,
    })),
    [
      { key: 'read-reviews', action: 'collect_review_results', dependsOn: [] },
      { key: 'draft', action: 'generate_text_draft', dependsOn: ['read-reviews'] },
    ]
  );
});

test('branch traversal activates only the matching action path', () => {
  const { workflow } = validateAndCompileVisualWorkflow(validWorkflow);
  assert.deepEqual(
    [
      ...activeVisualActionIds(
        workflow,
        new Map([['read-reviews', { reviews: [{ reviewId: 'review-1' }] }]])
      ),
    ],
    ['read-reviews', 'draft']
  );
  assert.deepEqual(
    [...activeVisualActionIds(workflow, new Map([['read-reviews', { reviews: [] }]]))],
    ['read-reviews']
  );
});

test('safe predefined conditions inspect only supported outputs', () => {
  const reviewAction = validWorkflow.nodes.find((node) => node.id === 'read-reviews');
  assert.equal(reviewAction?.type, 'action');
  if (reviewAction?.type !== 'action') throw new Error('Expected review action.');
  assert.equal(
    evaluateVisualCondition({ kind: 'review_count', operator: 'eq', value: 1 }, reviewAction, {
      reviews: [{ reviewId: 'review-1' }],
    }),
    true
  );

  const githubContextAction = {
    id: 'context',
    type: 'action' as const,
    title: 'Read GitHub',
    description: 'Read GitHub project context.',
    action: 'collect_github_context' as const,
    input: { repository: 'owner/repo' },
  };
  assert.equal(
    evaluateVisualCondition(
      { kind: 'github_context_status', equals: 'partial' },
      githubContextAction,
      { context: { status: 'partial' } }
    ),
    true
  );
  assert.equal(
    evaluateVisualCondition(
      { kind: 'github_context_status', equals: 'complete' },
      githubContextAction,
      { draft: 'not GitHub context' }
    ),
    false
  );
});

test('server rejects unsupported triggers, operations, and unsafe condition expressions', () => {
  assert.throws(
    () =>
      validateAndCompileVisualWorkflow({
        ...validWorkflow,
        nodes: validWorkflow.nodes.map((node) =>
          node.type === 'manual' ? { ...node, type: 'scheduled' } : node
        ),
      }),
    VisualWorkflowValidationError
  );
  assert.throws(
    () =>
      validateAndCompileVisualWorkflow({
        ...validWorkflow,
        nodes: validWorkflow.nodes.map((node) =>
          node.id === 'draft' && node.type === 'action'
            ? { ...node, action: 'run_shell', input: { command: 'whoami' } }
            : node
        ),
      }),
    VisualWorkflowValidationError
  );
  assert.throws(
    () =>
      validateAndCompileVisualWorkflow({
        ...validWorkflow,
        nodes: validWorkflow.nodes.map((node) =>
          node.type === 'condition'
            ? { ...node, condition: { kind: 'expression', expression: 'process.exit()' } }
            : node
        ),
      }),
    VisualWorkflowValidationError
  );
});

test('server rejects cycles, invalid connections, and merge paths', () => {
  assert.throws(
    () =>
      validateAndCompileVisualWorkflow({
        ...validWorkflow,
        edges: [...validWorkflow.edges, { id: 'cycle', from: 'result', to: 'manual' }],
      }),
    (error: unknown) =>
      error instanceof VisualWorkflowValidationError &&
      error.issues.some((issue) => /cycle|entry|reachable/i.test(issue))
  );
  assert.throws(
    () =>
      validateAndCompileVisualWorkflow({
        ...validWorkflow,
        edges: [...validWorkflow.edges, { id: 'missing-node', from: 'draft', to: 'unknown' }],
      }),
    VisualWorkflowValidationError
  );
  assert.throws(
    () =>
      validateAndCompileVisualWorkflow({
        ...validWorkflow,
        edges: [...validWorkflow.edges, { id: 'merge', from: 'empty', to: 'result' }],
      }),
    (error: unknown) =>
      error instanceof VisualWorkflowValidationError &&
      error.issues.some((issue) => /incoming connection|merge paths/i.test(issue))
  );
});

test('server rejects invalid action inputs and condition/action mismatches', () => {
  assert.throws(
    () =>
      validateAndCompileVisualWorkflow({
        ...validWorkflow,
        nodes: validWorkflow.nodes.map((node) =>
          node.id === 'read-reviews' && node.type === 'action'
            ? { ...node, input: { command: 'whoami' } }
            : node
        ),
      }),
    VisualWorkflowValidationError
  );
  assert.throws(
    () =>
      validateAndCompileVisualWorkflow({
        ...validWorkflow,
        nodes: validWorkflow.nodes.map((node) =>
          node.type === 'condition'
            ? { ...node, condition: { kind: 'github_context_status', equals: 'complete' } }
            : node
        ),
      }),
    (error: unknown) =>
      error instanceof VisualWorkflowValidationError &&
      error.issues.some((issue) => /nearest preceding action/i.test(issue))
  );
});

test('approval payload binds the saved graph and execution permissions to its owner', () => {
  const { plan, workflow } = validateAndCompileVisualWorkflow(validWorkflow);
  const source = {
    goal: 'Prepare an update.',
    title: plan.title,
    workflowDefinition: workflow,
    tasks: plan.tasks.map((task) => ({
      key: task.key,
      title: task.title,
      description: task.description,
      action: task.action,
      dependencies: task.dependsOn,
      input: task.input,
    })),
  };
  const payload = createApprovalPayload(source);
  const authorization = {
    mode: 'APPROVAL_REQUIRED' as const,
    userId: 'user-a',
    approval: {
      userId: 'user-a',
      status: 'APPROVED',
      payload,
      payloadHash: hashApprovalPayload(payload),
      expiresAt: new Date(Date.now() + 60_000),
      decidedAt: new Date(),
    },
    plan: source,
  };
  assert.equal(isAutomationExecutionAuthorized(authorization), true);
  assert.equal(
    isAutomationExecutionAuthorized({
      ...authorization,
      userId: 'user-b',
    }),
    false
  );
  assert.equal(
    isAutomationExecutionAuthorized({
      ...authorization,
      plan: { ...source, workflowDefinition: { ...workflow, title: 'Tampered' } },
    }),
    false
  );
});

test('saved workflow survives JSON persistence and revalidates on load', () => {
  const saved = JSON.parse(JSON.stringify(validWorkflow)) as unknown;
  const loaded = validateAndCompileVisualWorkflow(saved);
  assert.deepEqual(loaded.workflow, validWorkflow);
  assert.equal(loaded.plan.tasks.length, 2);
});
