import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Play, Plus, Save, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  automationApi,
  getAutomationErrorMessage,
  type VisualAction,
  type VisualCondition,
  type VisualWorkflowDefinition,
  type VisualWorkflowNode,
} from '../api/automationApi';
import { useAutomations } from '../hooks/useAutomations';

const initialWorkflow: VisualWorkflowDefinition = {
  title: 'Review and prepare a project update',
  nodes: [
    { id: 'manual-start', type: 'manual', label: 'Run manually' },
    {
      id: 'owner-approval',
      type: 'approval',
      title: 'Owner approval',
      message: 'Review this workflow before its actions run.',
    },
    {
      id: 'collect-reviews',
      type: 'action',
      title: 'Collect completed reviews',
      description: 'Read this account’s completed code reviews.',
      action: 'collect_review_results',
      input: {},
    },
    {
      id: 'has-findings',
      type: 'condition',
      title: 'Any completed reviews?',
      condition: { kind: 'review_count', operator: 'gt', value: 0 },
    },
    {
      id: 'draft-update',
      type: 'action',
      title: 'Prepare an internal update',
      description: 'Create an internal draft using completed review results.',
      action: 'generate_text_draft',
      input: {},
    },
    { id: 'no-results', type: 'end', title: 'No matching results' },
    {
      id: 'workflow-result',
      type: 'result',
      title: 'Ready for review',
      resultLabel: 'Internal project update',
    },
  ],
  edges: [
    { id: 'edge-start-approval', from: 'manual-start', to: 'owner-approval' },
    { id: 'edge-approval-reviews', from: 'owner-approval', to: 'collect-reviews' },
    { id: 'edge-reviews-condition', from: 'collect-reviews', to: 'has-findings' },
    { id: 'edge-condition-draft', from: 'has-findings', to: 'draft-update', branch: 'true' },
    { id: 'edge-condition-empty', from: 'has-findings', to: 'no-results', branch: 'false' },
    { id: 'edge-draft-result', from: 'draft-update', to: 'workflow-result' },
  ],
};

const actionLabels: Record<VisualAction, string> = {
  collect_review_results: 'Collect completed code reviews',
  generate_text_draft: 'Generate internal text draft',
  collect_github_context: 'Collect GitHub repository context',
  create_github_issue: 'Create GitHub issue',
  create_github_pr_comment: 'Create GitHub pull-request comment',
};

const nodeColors: Record<VisualWorkflowNode['type'], string> = {
  manual: 'border-sky-400/40 bg-sky-400/10',
  approval: 'border-amber-400/40 bg-amber-400/10',
  action: 'border-indigo-400/40 bg-indigo-400/10',
  condition: 'border-violet-400/40 bg-violet-400/10',
  end: 'border-slate-500/40 bg-slate-500/10',
  result: 'border-emerald-400/40 bg-emerald-400/10',
};

const nodeTypeLabel: Record<VisualWorkflowNode['type'], string> = {
  manual: 'Manual trigger',
  approval: 'Approval gate',
  action: 'Action',
  condition: 'Condition',
  end: 'End',
  result: 'Result',
};

function makeId(prefix: string, existing: VisualWorkflowNode[]): string {
  const known = new Set(existing.map((node) => node.id));
  let index = existing.length + 1;
  while (known.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function defaultActionInput(action: VisualAction): Record<string, unknown> {
  if (action === 'collect_github_context') return { repository: 'owner/repository' };
  if (action === 'create_github_issue')
    return { repository: 'owner/repository', title: '', body: '' };
  if (action === 'create_github_pr_comment') {
    return { repository: 'owner/repository', pullRequestNumber: 1, body: '' };
  }
  return {};
}

function isActionNode(
  node: VisualWorkflowNode
): node is Extract<VisualWorkflowNode, { type: 'action' }> {
  return node.type === 'action';
}

function isConditionNode(
  node: VisualWorkflowNode
): node is Extract<VisualWorkflowNode, { type: 'condition' }> {
  return node.type === 'condition';
}

export const VisualWorkflowBuilderPage = (): JSX.Element => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const automations = useAutomations();
  const [workflow, setWorkflow] = useState<VisualWorkflowDefinition>(initialWorkflow);
  const [goal, setGoal] = useState(
    'Prepare an internal project update from completed code reviews.'
  );
  const [selectedId, setSelectedId] = useState<string | null>('collect-reviews');
  const [loadId, setLoadId] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [branch, setBranch] = useState<'true' | 'false'>('true');
  const [actionInputText, setActionInputText] = useState<Record<string, string>>({});
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<{
    valid: boolean;
    issues: string[];
    plan?: {
      tasks: Array<{ key: string; title: string; action: VisualAction; dependsOn: string[] }>;
    };
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const drafts = useMemo(
    () => (automations.data ?? []).filter((automation) => automation.workflowDefinition),
    [automations.data]
  );
  const selectedNode = workflow.nodes.find((node) => node.id === selectedId) ?? null;
  const inputError = selectedId ? inputErrors[selectedId] : undefined;
  const savedDraft = drafts.find((item) => item.id === savedId);

  const validateMutation = useMutation({
    mutationFn: () => automationApi.validateVisual(goal, workflow),
    onSuccess: (result) => {
      setValidation({ valid: true, issues: [], plan: result.plan });
      setNotice(
        'Server validation passed. Save the draft or review the compiled execution preview.'
      );
      setError('');
    },
    onError: (requestError: unknown) => {
      const message = getAutomationErrorMessage(requestError);
      const issues =
        typeof requestError === 'object' &&
        requestError !== null &&
        'response' in requestError &&
        typeof requestError.response === 'object' &&
        requestError.response !== null &&
        'data' in requestError.response &&
        typeof requestError.response.data === 'object' &&
        requestError.response.data !== null &&
        'issues' in requestError.response.data &&
        Array.isArray(requestError.response.data.issues)
          ? requestError.response.data.issues.filter(
              (item): item is string => typeof item === 'string'
            )
          : [message];
      setValidation({ valid: false, issues });
      setNotice('');
      setError(message);
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => automationApi.saveVisual(goal, workflow),
    onSuccess: async (automation) => {
      await queryClient.invalidateQueries({ queryKey: ['automations'] });
      setSavedId(automation.id);
      setNotice('Visual workflow draft saved. It has not been queued or executed.');
      setError('');
    },
    onError: (requestError: unknown) => {
      setError(getAutomationErrorMessage(requestError));
      setNotice('');
    },
  });

  const executeMutation = useMutation({
    mutationFn: automationApi.executeDraft,
    onSuccess: async (automation) => {
      await queryClient.invalidateQueries({ queryKey: ['automations'] });
      navigate(`/automations?view=approvals&workflow=${encodeURIComponent(automation.id)}`);
    },
    onError: (requestError: unknown) => setError(getAutomationErrorMessage(requestError)),
  });

  const markChanged = (): void => {
    setValidation(null);
    setNotice('');
    setError('');
    setSavedId(null);
  };

  const updateNode = (
    nodeId: string,
    update: (node: VisualWorkflowNode) => VisualWorkflowNode
  ): void => {
    markChanged();
    setWorkflow((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? update(node) : node)),
    }));
  };

  const addNode = (type: 'action' | 'condition' | 'end' | 'result'): void => {
    if (workflow.nodes.length >= 12) {
      setError('Visual workflows are limited to 12 nodes.');
      return;
    }
    const id = makeId(type, workflow.nodes);
    const node: VisualWorkflowNode =
      type === 'action'
        ? {
            id,
            type,
            title: 'New action',
            description: 'Describe the supported action.',
            action: 'generate_text_draft',
            input: {},
          }
        : type === 'condition'
          ? {
              id,
              type,
              title: 'Check review count',
              condition: { kind: 'review_count', operator: 'gt', value: 0 },
            }
          : { id, type, title: type === 'result' ? 'Workflow result' : 'End workflow' };
    markChanged();
    setWorkflow((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(id);
  };

  const deleteNode = (nodeId: string): void => {
    const node = workflow.nodes.find((item) => item.id === nodeId);
    if (!node || node.type === 'manual' || node.type === 'approval') return;
    markChanged();
    setWorkflow((current) => ({
      ...current,
      nodes: current.nodes.filter((item) => item.id !== nodeId),
      edges: current.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
    }));
    setSelectedId(null);
  };

  const connectNodes = (): void => {
    if (!fromId || !toId || fromId === toId) {
      setError('Choose two different nodes to connect.');
      return;
    }
    if (workflow.edges.some((edge) => edge.from === fromId && edge.to === toId)) {
      setError('Those nodes are already connected.');
      return;
    }
    const source = workflow.nodes.find((node) => node.id === fromId);
    const edge = {
      id: `edge-${fromId}-${toId}-${workflow.edges.length + 1}`,
      from: fromId,
      to: toId,
      ...(source?.type === 'condition' ? { branch } : {}),
    };
    markChanged();
    setWorkflow((current) => ({ ...current, edges: [...current.edges, edge] }));
  };

  const loadWorkflow = (): void => {
    const automation = drafts.find((item) => item.id === loadId);
    if (!automation?.workflowDefinition) return;
    setWorkflow(automation.workflowDefinition);
    setGoal(automation.goal);
    setSavedId(automation.id);
    setValidation(null);
    setError('');
    setNotice(`Loaded saved draft: ${automation.title}`);
    setSelectedId(automation.workflowDefinition.nodes[0]?.id ?? null);
  };

  const layout = useMemo(() => {
    const columnGap = 235;
    const height = Math.max(280, workflow.nodes.length * 105 + 70);
    const positions = new Map(
      workflow.nodes.map((node, index) => [
        node.id,
        { x: 75 + index * columnGap, y: Math.max(80, Math.min(height - 70, 80 + index * 20)) },
      ])
    );
    return { height, width: Math.max(520, workflow.nodes.length * columnGap + 80), positions };
  }, [workflow.nodes]);

  return (
    <main className="min-h-screen bg-[#090c12] px-4 py-6 text-slate-200 sm:px-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
              Automation / Builder
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white">Visual workflow builder</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Design a supported graph, validate it on the server, save a draft, then submit it to
              the existing approval and execution flow.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/automations')}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm"
          >
            Back to command center
          </button>
        </header>

        {(notice || error) && (
          <p
            role={error ? 'alert' : 'status'}
            className={`rounded-lg border p-3 text-sm ${error ? 'border-rose-400/30 bg-rose-400/10 text-rose-200' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'}`}
          >
            {error || notice}
          </p>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 space-y-4">
            <div className="grid gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:grid-cols-[1fr_280px]">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-slate-300">Workflow goal</span>
                <input
                  value={goal}
                  maxLength={2_000}
                  onChange={(event) => {
                    setGoal(event.target.value);
                    markChanged();
                  }}
                  className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2 text-sm"
                />
              </label>
              <div className="space-y-1 text-xs">
                <label htmlFor="load-saved-workflow" className="font-medium text-slate-300">
                  Load saved workflow draft
                </label>
                <div className="flex gap-2">
                  <select
                    id="load-saved-workflow"
                    value={loadId}
                    onChange={(event) => setLoadId(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2 text-sm"
                  >
                    <option value="">Choose a saved draft</option>
                    {drafts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title} · {item.status}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!loadId}
                    onClick={loadWorkflow}
                    className="rounded-lg border border-white/10 px-3 text-xs disabled:opacity-40"
                  >
                    Load
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => addNode('action')}
                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-300/20 px-3 py-2 text-xs text-indigo-200"
                >
                  <Plus size={14} /> Action
                </button>
                <button
                  type="button"
                  onClick={() => addNode('condition')}
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-300/20 px-3 py-2 text-xs text-violet-200"
                >
                  <Plus size={14} /> Condition
                </button>
                <button
                  type="button"
                  onClick={() => addNode('result')}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-300/20 px-3 py-2 text-xs text-emerald-200"
                >
                  <Plus size={14} /> Result
                </button>
                <button
                  type="button"
                  onClick={() => addNode('end')}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs"
                >
                  <Plus size={14} /> End
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Zoom out"
                  onClick={() => setZoom((value) => Math.max(50, value - 10))}
                  className="rounded border border-white/10 p-2"
                >
                  <ZoomOut size={14} />
                </button>
                <input
                  aria-label="Canvas zoom"
                  type="range"
                  min={50}
                  max={130}
                  step={10}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
                <span className="w-10 text-right text-xs text-slate-400">{zoom}%</span>
                <button
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => setZoom((value) => Math.min(130, value + 10))}
                  className="rounded border border-white/10 p-2"
                >
                  <ZoomIn size={14} />
                </button>
              </div>
            </div>

            <div
              className="overflow-auto rounded-xl border border-white/[0.08] bg-[#0b0f17] p-4"
              aria-label="Workflow graph canvas"
            >
              <div
                style={{ width: (layout.width * zoom) / 100, height: (layout.height * zoom) / 100 }}
              >
                <div
                  className="relative origin-top-left"
                  style={{
                    width: layout.width,
                    height: layout.height,
                    transform: `scale(${zoom / 100})`,
                  }}
                >
                  <svg
                    className="pointer-events-none absolute inset-0"
                    width={layout.width}
                    height={layout.height}
                    aria-hidden="true"
                  >
                    {workflow.edges.map((edge) => {
                      const source = layout.positions.get(edge.from);
                      const target = layout.positions.get(edge.to);
                      if (!source || !target) return null;
                      const startX = source.x + 185;
                      const endX = target.x;
                      const middleX = (startX + endX) / 2;
                      return (
                        <g key={edge.id}>
                          <path
                            d={`M ${startX} ${source.y + 42} C ${middleX} ${source.y + 42}, ${middleX} ${target.y + 42}, ${endX} ${target.y + 42}`}
                            fill="none"
                            stroke="#64748b"
                            strokeWidth="2"
                          />
                          <text
                            x={middleX}
                            y={(source.y + target.y) / 2 + 35}
                            fill="#a5b4fc"
                            fontSize="10"
                            textAnchor="middle"
                          >
                            {edge.branch ?? ''}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  {workflow.nodes.map((node) => {
                    const position = layout.positions.get(node.id);
                    if (!position) return null;
                    const selected = node.id === selectedId;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => setSelectedId(node.id)}
                        aria-pressed={selected}
                        className={`absolute w-[185px] rounded-xl border p-3 text-left shadow-lg transition ${nodeColors[node.type]} ${selected ? 'ring-2 ring-indigo-300' : 'hover:border-white/30'}`}
                        style={{ left: position.x, top: position.y }}
                      >
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                          {nodeTypeLabel[node.type]}
                        </span>
                        <span className="mt-1 block truncate text-xs font-semibold text-white">
                          {node.type === 'manual' ? node.label : node.title}
                        </span>
                        {node.type === 'action' && (
                          <span className="mt-1 block truncate text-[10px] text-slate-400">
                            {actionLabels[node.action]}
                          </span>
                        )}
                        {node.type === 'condition' && (
                          <span className="mt-1 block truncate text-[10px] text-slate-400">
                            {node.condition.kind.replace(/_/g, ' ')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Scroll the canvas to pan. Use the zoom controls to resize it. Connections are edited
              below; branches must be labelled true/false.
            </p>

            <section className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <h2 className="text-sm font-semibold text-white">Connections</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Connection source node"
                  value={fromId}
                  onChange={(event) => setFromId(event.target.value)}
                  className="min-w-40 rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2 text-xs"
                >
                  <option value="">From node</option>
                  {workflow.nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.id} · {nodeTypeLabel[node.type]}
                    </option>
                  ))}
                </select>
                <ArrowRight size={15} className="text-slate-500" />
                <select
                  aria-label="Connection destination node"
                  value={toId}
                  onChange={(event) => setToId(event.target.value)}
                  className="min-w-40 rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2 text-xs"
                >
                  <option value="">To node</option>
                  {workflow.nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.id} · {nodeTypeLabel[node.type]}
                    </option>
                  ))}
                </select>
                {workflow.nodes.find((node) => node.id === fromId)?.type === 'condition' && (
                  <select
                    aria-label="Condition branch"
                    value={branch}
                    onChange={(event) => setBranch(event.target.value as 'true' | 'false')}
                    className="rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2 text-xs"
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                )}
                <button
                  type="button"
                  onClick={connectNodes}
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium"
                >
                  Connect
                </button>
              </div>
              <ul className="space-y-2">
                {workflow.edges.map((edge) => (
                  <li
                    key={edge.id}
                    className="flex items-center justify-between rounded-lg border border-white/[0.06] px-3 py-2 text-xs"
                  >
                    <span>
                      {edge.from} <ArrowRight className="mx-1 inline" size={12} /> {edge.to}
                      {edge.branch ? ` · ${edge.branch}` : ''}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove connection ${edge.from} to ${edge.to}`}
                      onClick={() => {
                        markChanged();
                        setWorkflow((current) => ({
                          ...current,
                          edges: current.edges.filter((item) => item.id !== edge.id),
                        }));
                      }}
                      className="text-rose-300"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </section>

          <aside className="space-y-4">
            <section className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Node configuration</h2>
                {selectedNode &&
                  selectedNode.type !== 'manual' &&
                  selectedNode.type !== 'approval' && (
                    <button
                      type="button"
                      aria-label="Delete selected node"
                      onClick={() => deleteNode(selectedNode.id)}
                      className="rounded p-1.5 text-rose-300 hover:bg-rose-400/10"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
              </div>
              {!selectedNode && (
                <p className="text-xs text-slate-500">
                  Select a node in the canvas to edit its configuration.
                </p>
              )}
              {selectedNode && (
                <div className="space-y-3">
                  <p className="text-[10px] text-slate-500">
                    {nodeTypeLabel[selectedNode.type]} · {selectedNode.id}
                  </p>
                  {selectedNode.type === 'manual' && (
                    <p className="text-xs text-slate-400">
                      Manual runs are supported. Scheduling and generic GitHub workflow events are
                      not implemented and are intentionally unavailable.
                    </p>
                  )}
                  {selectedNode.type === 'approval' && (
                    <p className="text-xs text-amber-200">
                      This node uses the existing owner approval inbox before any action is queued.
                    </p>
                  )}
                  {selectedNode.type !== 'manual' && selectedNode.type !== 'approval' && (
                    <label className="block space-y-1 text-xs">
                      <span>Node title</span>
                      <input
                        value={selectedNode.title}
                        maxLength={100}
                        onChange={(event) =>
                          updateNode(selectedNode.id, (node) =>
                            node.type === 'manual' ? node : { ...node, title: event.target.value }
                          )
                        }
                        className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2"
                      />
                    </label>
                  )}
                  {selectedNode.type === 'approval' && (
                    <label className="block space-y-1 text-xs">
                      <span>Approval summary</span>
                      <textarea
                        rows={3}
                        value={selectedNode.message}
                        onChange={(event) =>
                          updateNode(selectedNode.id, (node) =>
                            node.type === 'approval'
                              ? { ...node, message: event.target.value }
                              : node
                          )
                        }
                        className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2"
                      />
                    </label>
                  )}
                  {isActionNode(selectedNode) && (
                    <>
                      <label className="block space-y-1 text-xs">
                        <span>Supported operation</span>
                        <select
                          value={selectedNode.action}
                          onChange={(event) =>
                            updateNode(selectedNode.id, (node) =>
                              node.type === 'action'
                                ? {
                                    ...node,
                                    action: event.target.value as VisualAction,
                                    input: defaultActionInput(event.target.value as VisualAction),
                                  }
                                : node
                            )
                          }
                          className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2"
                        >
                          {Object.entries(actionLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-1 text-xs">
                        <span>Task description</span>
                        <textarea
                          rows={2}
                          value={selectedNode.description}
                          onChange={(event) =>
                            updateNode(selectedNode.id, (node) =>
                              node.type === 'action'
                                ? { ...node, description: event.target.value }
                                : node
                            )
                          }
                          className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2"
                        />
                      </label>
                      <label className="block space-y-1 text-xs">
                        <span>Action input (JSON)</span>
                        <textarea
                          rows={6}
                          value={
                            actionInputText[selectedNode.id] ??
                            JSON.stringify(selectedNode.input, null, 2)
                          }
                          onChange={(event) => {
                            const text = event.target.value;
                            setActionInputText((current) => ({
                              ...current,
                              [selectedNode.id]: text,
                            }));
                            try {
                              const input: unknown = JSON.parse(text);
                              if (
                                typeof input !== 'object' ||
                                input === null ||
                                Array.isArray(input)
                              )
                                throw new Error('Action input must be a JSON object.');
                              setInputErrors((current) => {
                                const next = { ...current };
                                delete next[selectedNode.id];
                                return next;
                              });
                              updateNode(selectedNode.id, (node) =>
                                node.type === 'action'
                                  ? { ...node, input: input as Record<string, unknown> }
                                  : node
                              );
                            } catch (parseError) {
                              const message =
                                parseError instanceof Error ? parseError.message : 'Invalid JSON.';
                              setInputErrors((current) => ({
                                ...current,
                                [selectedNode.id]: message,
                              }));
                              setValidation(null);
                            }
                          }}
                          className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2 font-mono"
                        />
                      </label>
                      {inputError && <p className="text-xs text-rose-300">{inputError}</p>}
                      {(selectedNode.action === 'create_github_issue' ||
                        selectedNode.action === 'create_github_pr_comment') && (
                        <p className="text-[11px] text-amber-200">
                          This action can modify GitHub. The server checks connected-account write
                          permission, and the existing owner approval is required before execution.
                        </p>
                      )}
                    </>
                  )}
                  {isConditionNode(selectedNode) && (
                    <ConditionConfiguration
                      node={selectedNode}
                      update={(condition) =>
                        updateNode(selectedNode.id, (node) =>
                          node.type === 'condition' ? { ...node, condition } : node
                        )
                      }
                    />
                  )}
                  {(selectedNode.type === 'end' || selectedNode.type === 'result') && (
                    <label className="block space-y-1 text-xs">
                      <span>Result label (optional)</span>
                      <input
                        value={selectedNode.resultLabel ?? ''}
                        maxLength={120}
                        onChange={(event) =>
                          updateNode(selectedNode.id, (node) =>
                            node.type === 'end' || node.type === 'result'
                              ? { ...node, resultLabel: event.target.value || undefined }
                              : node
                          )
                        }
                        className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2"
                      />
                    </label>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <h2 className="text-sm font-semibold text-white">Validation and lifecycle</h2>
              <p className="text-xs text-slate-400">
                Every save is revalidated by the server. Visual workflows save as drafts; execution
                requires owner approval and the existing quota/queue/audit checks.
              </p>
              <button
                type="button"
                disabled={
                  validateMutation.isPending ||
                  Boolean(Object.keys(inputErrors).length) ||
                  !goal.trim()
                }
                onClick={() => validateMutation.mutate()}
                className="w-full rounded-lg border border-indigo-300/30 px-3 py-2 text-xs text-indigo-200 disabled:opacity-40"
              >
                {validateMutation.isPending ? 'Validating…' : 'Validate workflow'}
              </button>
              <button
                type="button"
                disabled={
                  saveMutation.isPending || !goal.trim() || Boolean(Object.keys(inputErrors).length)
                }
                onClick={() => saveMutation.mutate()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium disabled:opacity-40"
              >
                <Save size={14} />{' '}
                {saveMutation.isPending
                  ? 'Saving draft…'
                  : savedId
                    ? 'Save as new draft'
                    : 'Save draft'}
              </button>
              {savedId && (
                <button
                  type="button"
                  disabled={executeMutation.isPending || savedDraft?.status !== 'DRAFT'}
                  onClick={() => executeMutation.mutate(savedId)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300/30 px-3 py-2 text-xs text-amber-100 disabled:opacity-40"
                >
                  <Play size={14} />{' '}
                  {executeMutation.isPending
                    ? 'Submitting…'
                    : savedDraft?.status === 'DRAFT'
                      ? 'Submit for approval'
                      : 'Draft already submitted'}
                </button>
              )}
              {validation?.valid && (
                <p className="flex items-center gap-1 text-xs text-emerald-300">
                  <Check size={14} /> Server validation passed.
                </p>
              )}
              {validation && !validation.valid && (
                <ul className="space-y-1 text-xs text-rose-300">
                  {validation.issues.map((issue, index) => (
                    <li key={`${index}-${issue}`}>{issue}</li>
                  ))}
                </ul>
              )}
              {validation?.plan && (
                <div className="space-y-2 border-t border-white/[0.08] pt-3">
                  <h3 className="text-xs font-semibold text-slate-200">Execution preview</h3>
                  <ol className="space-y-2">
                    {validation.plan.tasks.map((task, index) => (
                      <li
                        key={task.key}
                        className="rounded-lg border border-white/[0.06] p-2 text-[11px]"
                      >
                        <span className="text-slate-500">{index + 1}. </span>
                        <strong>{task.title}</strong>
                        <span className="mt-1 block text-slate-500">
                          {actionLabels[task.action]}
                          {task.dependsOn.length ? ` · after ${task.dependsOn.join(', ')}` : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="text-[10px] text-slate-500">
                    Condition branches are resolved by the worker using saved outputs. Inactive
                    branch actions are marked skipped in workflow history.
                  </p>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-4 text-xs leading-5 text-amber-100/80">
              <h2 className="font-semibold text-amber-100">Supported trigger scope</h2>
              <p className="mt-1">
                Only manual triggers are available. Phase 7 does not implement scheduled workflow
                execution or generic GitHub event triggers. Its pull-request webhook starts code
                reviews, not user-defined workflows.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
};

function ConditionConfiguration({
  node,
  update,
}: {
  node: Extract<VisualWorkflowNode, { type: 'condition' }>;
  update: (condition: VisualCondition) => void;
}): JSX.Element {
  const condition = node.condition;
  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-xs">
        <span>Safe condition</span>
        <select
          value={condition.kind}
          onChange={(event) => {
            const kind = event.target.value;
            if (kind === 'review_count') update({ kind, operator: 'gt', value: 0 });
            else if (kind === 'github_context_status') update({ kind, equals: 'complete' });
            else update({ kind: 'github_write_status', equals: 'created' });
          }}
          className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2"
        >
          <option value="review_count">Completed review count</option>
          <option value="github_context_status">GitHub context status</option>
          <option value="github_write_status">GitHub write result</option>
        </select>
      </label>
      {condition.kind === 'review_count' && (
        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <label className="space-y-1 text-xs">
            <span>Comparison</span>
            <select
              value={condition.operator}
              onChange={(event) =>
                update({ ...condition, operator: event.target.value as 'gt' | 'eq' })
              }
              className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2"
            >
              <option value="gt">Greater than</option>
              <option value="eq">Equal to</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span>Count</span>
            <input
              type="number"
              min="0"
              max="10000"
              step="1"
              value={condition.value}
              onChange={(event) => update({ ...condition, value: Number(event.target.value) })}
              className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2"
            />
          </label>
        </div>
      )}
      {condition.kind === 'github_context_status' && (
        <label className="block space-y-1 text-xs">
          <span>Expected status</span>
          <select
            value={condition.equals}
            onChange={(event) =>
              update({ ...condition, equals: event.target.value as 'complete' | 'partial' })
            }
            className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2"
          >
            <option value="complete">Complete</option>
            <option value="partial">Partial</option>
          </select>
        </label>
      )}
      {condition.kind === 'github_write_status' && (
        <label className="block space-y-1 text-xs">
          <span>Expected write status</span>
          <select
            value={condition.equals}
            onChange={(event) =>
              update({ ...condition, equals: event.target.value as 'created' | 'already_created' })
            }
            className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2"
          >
            <option value="created">Created</option>
            <option value="already_created">Already created</option>
          </select>
        </label>
      )}
      <p className="text-[11px] text-slate-500">
        Conditions can only inspect the output type explicitly supported by their nearest preceding
        action. No expressions or user-supplied code are evaluated.
      </p>
    </div>
  );
}
