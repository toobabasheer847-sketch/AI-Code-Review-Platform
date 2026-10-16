import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  AlertCircle,
  Clock3,
  FileSearch,
  ListFilter,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Workflow,
  X,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useMe } from '@/features/auth/hooks/useAuth';

import {
  getAutomationErrorMessage,
  type Automation,
  type AutomationMode,
  type AutomationTask,
  type AutomationStatus,
} from '../api/automationApi';
import { automationExamples } from '../automation.constants';
import { AutomationCommandInput } from '../components/AutomationCommandInput';
import { AutomationShell } from '../components/AutomationShell';
import { DashboardMetricCard } from '../components/DashboardMetricCard';
import {
  useApproveAutomation,
  useAutomations,
  useCancelAutomation,
  useCreateAutomation,
  useRejectAutomation,
  useRetryAutomation,
} from '../hooks/useAutomations';

type View = 'command' | 'workflows' | 'approvals' | 'history';

const viewOptions: Array<{ id: View; label: string }> = [
  { id: 'command', label: 'Command' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'approvals', label: 'Approval inbox' },
  { id: 'history', label: 'Execution history' },
];

const statusStyles: Record<AutomationStatus, string> = {
  DRAFT: 'border-slate-500/25 bg-slate-500/[0.08] text-slate-300',
  AWAITING_APPROVAL: 'border-amber-400/25 bg-amber-400/[0.08] text-amber-200',
  QUEUED: 'border-sky-400/25 bg-sky-400/[0.08] text-sky-200',
  RUNNING: 'border-indigo-400/25 bg-indigo-400/[0.08] text-indigo-200',
  COMPLETED: 'border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200',
  FAILED: 'border-rose-400/25 bg-rose-400/[0.08] text-rose-200',
  CANCELED: 'border-slate-500/25 bg-slate-500/[0.08] text-slate-300',
  REJECTED: 'border-rose-400/25 bg-rose-400/[0.08] text-rose-200',
};

const statusLabel: Record<AutomationStatus, string> = {
  DRAFT: 'Draft',
  AWAITING_APPROVAL: 'Awaiting approval',
  QUEUED: 'Queued',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELED: 'Canceled',
  REJECTED: 'Rejected',
};

const taskStatusStyles: Record<AutomationTask['status'], string> = {
  PENDING: 'text-slate-500',
  AWAITING_APPROVAL: 'text-amber-300',
  READY: 'text-sky-300',
  RUNNING: 'text-indigo-300',
  COMPLETED: 'text-emerald-300',
  FAILED: 'text-rose-300',
  CANCELED: 'text-slate-500',
};

const activeStatuses: AutomationStatus[] = ['AWAITING_APPROVAL', 'QUEUED', 'RUNNING'];

function StatusBadge({ status }: { status: AutomationStatus }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${statusStyles[status]}`}
    >
      {status === 'RUNNING' && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
      {statusLabel[status]}
    </span>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function DraftOutput({ task }: { task: AutomationTask }): JSX.Element | null {
  if (typeof task.output !== 'object' || task.output === null) return null;
  if ('draft' in task.output && typeof task.output.draft === 'string') {
    return (
      <div className="mt-3 rounded-lg border border-white/[0.07] bg-[#090c12] p-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Generated draft · AI output, not verified
        </p>
        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{task.output.draft}</p>
      </div>
    );
  }
  if ('context' in task.output && isRecord(task.output.context)) {
    const context = task.output.context;
    const evidence: Array<{ label: string; url: string }> = [];
    const addLinks = (key: string, label: string): void => {
      const value = context[key];
      if (!Array.isArray(value)) return;
      value.forEach((item, index) => {
        if (typeof item !== 'object' || item === null || !('url' in item) || typeof item.url !== 'string') return;
        try {
          const url = new URL(item.url);
          if (url.protocol === 'https:' && url.hostname === 'github.com') {
            evidence.push({ label: `${label} ${index + 1}`, url: url.toString() });
          }
        } catch {
          return;
        }
      });
    };
    addLinks('commits', 'Commit');
    addLinks('pullRequests', 'Pull request');
    addLinks('completedReviews', 'Completed review');
    const reviews = context.completedReviews;
    if (Array.isArray(reviews)) {
      reviews.forEach((review, reviewIndex) => {
        if (!isRecord(review) || !Array.isArray(review.findings)) return;
        review.findings.forEach((finding, findingIndex) => {
          if (!isRecord(finding) || typeof finding.evidenceUrl !== 'string') return;
          try {
            const url = new URL(finding.evidenceUrl);
            if (url.protocol === 'https:' && url.hostname === 'github.com') {
              evidence.push({
                label: `Review ${reviewIndex + 1} finding ${findingIndex + 1}`,
                url: url.toString(),
              });
            }
          } catch {
            return;
          }
        });
      });
    }
    if (
      'checks' in context &&
      typeof context.checks === 'object' &&
      context.checks !== null &&
      'runs' in context.checks &&
      Array.isArray(context.checks.runs)
    ) {
      context.checks.runs.forEach((item, index) => {
        if (typeof item !== 'object' || item === null || !('url' in item) || typeof item.url !== 'string') return;
        try {
          const url = new URL(item.url);
          if (url.protocol === 'https:' && url.hostname === 'github.com') {
            evidence.push({ label: `CI check ${index + 1}`, url: url.toString() });
          }
        } catch {
          return;
        }
      });
    }
    const partial = 'status' in context && context.status === 'partial';
    const ciAvailability =
      'checks' in context && typeof context.checks === 'object' && context.checks !== null &&
      'availability' in context.checks && typeof context.checks.availability === 'string'
        ? context.checks.availability
        : 'unknown';
    return (
      <div className="mt-3 rounded-lg border border-white/[0.07] bg-[#090c12] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          GitHub evidence · {partial ? 'partial data' : 'source data'}
        </p>
        <p className="mt-2 text-[11px] text-slate-400">
          CI checks: {ciAvailability}
          {isRecord(context.checks) && typeof context.checks.pullRequestNumber === 'number'
            ? ` (pull request #${context.checks.pullRequestNumber})`
            : ''}
        </p>
        {Array.isArray(context.failures) && context.failures.length > 0 && (
          <ul className="mt-2 list-inside list-disc space-y-1 text-[11px] text-amber-200/80">
            {context.failures.map((failure, index) => (
              <li key={index}>
                {typeof failure === 'object' && failure !== null && 'source' in failure && 'message' in failure
                  ? `${String(failure.source)}: ${String(failure.message)}`
                  : 'A GitHub data source was unavailable.'}
              </li>
            ))}
          </ul>
        )}
        {evidence.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {evidence.slice(0, 25).map((item, index) => (
              <li key={`${item.url}-${index}`}>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-indigo-300 underline decoration-indigo-300/30 underline-offset-2 hover:text-indigo-200"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-slate-500">No evidence links were returned.</p>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-[10px] text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
            Inspect collected context
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-slate-400">
            {JSON.stringify(context, null, 2)}
          </pre>
        </details>
      </div>
    );
  }
  if ('url' in task.output && typeof task.output.url === 'string') {
    let resultUrl: URL | null = null;
    try {
      resultUrl = new URL(task.output.url);
    } catch {
      resultUrl = null;
    }
    if (resultUrl?.protocol === 'https:' && resultUrl.hostname === 'github.com') {
      return (
        <p className="mt-3 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.035] px-3 py-2 text-[11px] text-emerald-200">
          GitHub returned a recorded result:{' '}
          <a href={resultUrl.toString()} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Open on GitHub
          </a>
        </p>
      );
    }
  }
  if (!('reviews' in task.output) || !Array.isArray(task.output.reviews)) return null;
  return (
    <details className="mt-3 rounded-lg border border-white/[0.07] bg-[#090c12] p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
        <span>Saved review results ({task.output.reviews.length})</span>
        <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden="true" />
      </summary>
      {'notice' in task.output && typeof task.output.notice === 'string' && (
        <p className="mt-3 text-xs leading-5 text-slate-500">{task.output.notice}</p>
      )}
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-400">
        {JSON.stringify(task.output.reviews, null, 2)}
      </pre>
    </details>
  );
}

function ApprovalActionPreview({
    action,
    input,
}: {
    action: AutomationTask['action'];
    input: unknown;
}): JSX.Element | null {
    if (
      (action !== 'create_github_issue' && action !== 'create_github_pr_comment') ||
      !isRecord(input)
    ) {
      return null;
    }
    const title = typeof input.title === 'string' ? input.title : null;
    const body = typeof input.body === 'string' ? input.body : null;
    const repository = typeof input.repository === 'string' ? input.repository : null;
    const pullRequestNumber =
      typeof input.pullRequestNumber === 'number' ? input.pullRequestNumber : null;
    return (
      <div className="mt-3 rounded-md border border-amber-400/15 bg-amber-400/[0.025] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-200/80">
          Exact external action preview
        </p>
        {repository && <p className="mt-2 text-[11px] text-slate-400">Repository: {repository}</p>}
        {title && <p className="mt-1 text-[11px] font-medium text-slate-200">Issue title: {title}</p>}
        {pullRequestNumber !== null && (
          <p className="mt-1 text-[11px] text-slate-400">Pull request: #{pullRequestNumber}</p>
        )}
        {body && (
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-[#080b12] p-2.5 text-[11px] leading-5 text-slate-300">
            {body}
          </pre>
        )}
        <p className="mt-2 text-[10px] text-amber-100/60">
          This exact content is included in the server-verified approval fingerprint.
        </p>
      </div>
    );
}

function WorkflowCard({
  automation,
  expanded,
  onToggle,
  onApprove,
  onReject,
  onCancel,
  onRetry,
  pending,
}: {
  automation: Automation;
  expanded: boolean;
  onToggle: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  pending: boolean;
}): JSX.Element {
  const approval = automation.approvals.find((item) => item.status === 'PENDING');
  const completedTasks = automation.tasks.filter((task) => task.status === 'COMPLETED').length;
  const progress = automation.tasks.length
    ? Math.round((completedTasks / automation.tasks.length) * 100)
    : 0;
  const canCancel = ['DRAFT', 'AWAITING_APPROVAL', 'QUEUED', 'RUNNING'].includes(automation.status);

  return (
    <article className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#0e121b]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="block w-full p-4 text-left transition hover:bg-white/[0.015] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="truncate text-sm font-semibold text-white">{automation.title}</h3>
              <StatusBadge status={automation.status} />
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{automation.goal}</p>
          </div>
          <span className="shrink-0 text-[10px] text-slate-600">
            {new Date(automation.createdAt).toLocaleString()}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div
            className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]"
            role="progressbar"
            aria-label={`${automation.title} task progress`}
            aria-valuemin={0}
            aria-valuemax={automation.tasks.length}
            aria-valuenow={completedTasks}
          >
            <div
              className="h-full rounded-full bg-indigo-400 transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="whitespace-nowrap text-[10px] text-slate-500">
            {completedTasks}/{automation.tasks.length} tasks
          </span>
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] px-4 pb-5 pt-4 sm:px-5">
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">Goal</p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-400">{automation.goal}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">Execution mode</p>
              <p className="mt-1 text-xs text-slate-400">{automation.mode.replace(/_/g, ' ').toLowerCase()}</p>
              {automation.approvals[0] && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Approval {automation.approvals[0].status.toLowerCase()}
                  {automation.approvals[0].decidedAt &&
                    ` · decided ${new Date(automation.approvals[0].decidedAt).toLocaleString()}`}
                </p>
              )}
            </div>
          </div>

          {approval && (
            <div className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/[0.04] p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-amber-100">Plan approval required</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{approval.summary}</p>
                  <p className="mt-2 text-[10px] text-slate-500">
                    Expires {new Date(approval.expiresAt).toLocaleString()}. Approving starts only
                    the internal steps listed below; it cannot publish or change external services.
                  </p>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[10px] font-medium text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                      Inspect exact approved plan payload
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/[0.06] bg-[#090c12] p-3 text-[10px] leading-5 text-slate-400">
                      {JSON.stringify(approval.payload, null, 2)}
                    </pre>
                  </details>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Approve "${automation.title}"? This authorizes only the listed internal read and draft tasks. No external action will be performed.`
                          )
                        ) {
                          onApprove(automation.id);
                        }
                      }}
                      disabled={pending || new Date(approval.expiresAt).getTime() <= Date.now()}
                      className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-amber-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Approve internal plan
                    </button>
                    <button
                      type="button"
                      onClick={() => onReject(automation.id)}
                      disabled={pending}
                      className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-medium text-slate-300 transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Reject plan
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <ol className="space-y-2" aria-label="Workflow tasks">
            {automation.tasks.map((task, index) => (
              <li key={task.id} className="relative rounded-lg border border-white/[0.06] bg-[#0a0d14] p-3.5">
                {index < automation.tasks.length - 1 && (
                  <span className="absolute bottom-0 left-[25px] h-2 translate-y-full border-l border-dashed border-white/10" aria-hidden="true" />
                )}
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.025] text-[10px] font-semibold text-slate-400">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold text-slate-200">{task.title}</h4>
                      <span className={`text-[10px] font-medium ${taskStatusStyles[task.status]}`}>
                        {task.status.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">{task.description}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600">
                      <span>{task.action.replace(/_/g, ' ')}</span>
                      <span>{task.attempts} {task.attempts === 1 ? 'attempt' : 'attempts'}</span>
                      {task.dependencies.length > 0 && (
                        <span>After: {task.dependencies.join(', ')}</span>
                      )}
                    </div>
                    {task.errorMessage && (
                      <p className="mt-2 text-xs text-rose-300" role="alert">{task.errorMessage}</p>
                    )}
                    <DraftOutput task={task} />
                    {task.executionAttempts.length > 0 && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-[10px] text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                          Attempt history ({task.executionAttempts.length})
                        </summary>
                        <ol className="mt-2 space-y-2">
                          {task.executionAttempts.map((attempt) => (
                            <li key={attempt.id} className="rounded-md border border-white/[0.06] p-3 text-[10px] text-slate-500">
                              <div className="flex flex-wrap justify-between gap-2">
                                <span>Attempt {attempt.attemptNumber} · {attempt.status.toLowerCase()}</span>
                                <time>{new Date(attempt.startedAt).toLocaleString()}</time>
                              </div>
                              {attempt.errorMessage && <p className="mt-2 text-rose-300">{attempt.errorMessage}</p>}
                              {attempt.output !== null && (
                                <pre className="mt-2 whitespace-pre-wrap break-words text-slate-400">
                                  {JSON.stringify(attempt.output, null, 2)}
                                </pre>
                              )}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-4 flex flex-wrap gap-2">
            {automation.status === 'FAILED' && (
              <button
                type="button"
                onClick={() => onRetry(automation.id)}
                disabled={pending}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-medium text-slate-300 transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry workflow
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={() => onCancel(automation.id)}
                disabled={pending}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-medium text-slate-400 transition hover:border-rose-400/20 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel workflow
              </button>
            )}
          </div>

          <details className="mt-4 border-t border-white/[0.06] pt-3">
            <summary className="cursor-pointer text-[11px] font-medium text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
              Workflow event history ({automation.events.length})
            </summary>
            {automation.events.length === 0 ? (
              <p className="mt-3 text-xs text-slate-600">No events have been recorded.</p>
            ) : (
              <ol className="mt-3 space-y-3 border-l border-white/[0.08] pl-4">
                {automation.events.map((event) => (
                  <li key={event.id} className="relative text-xs text-slate-400">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-slate-700" aria-hidden="true" />
                    <time className="mr-2 text-[10px] text-slate-600">{new Date(event.createdAt).toLocaleString()}</time>
                    {event.message}
                  </li>
                ))}
              </ol>
            )}
          </details>
        </div>
      )}
    </article>
  );
}

function EmptyPanel({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-white/[0.1] bg-white/[0.01] px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-slate-500">
        <Workflow className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-slate-200">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

export const AutomationPage = (): JSX.Element => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view') as View | null;
  const view: View = viewOptions.some((option) => option.id === requestedView)
    ? (requestedView as View)
    : 'command';
  const setView = (next: View): void => {
    setSearchParams(next === 'command' ? {} : { view: next }, { replace: true });
  };
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<AutomationMode>('APPROVAL_REQUIRED');
  const [formError, setFormError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AutomationStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(() => searchParams.get('workflow'));
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);
  const [createdAutomation, setCreatedAutomation] = useState<Automation | null>(null);
  const { data: user } = useMe();
  const automations = useAutomations();
  const create = useCreateAutomation();
  const approve = useApproveAutomation();
  const reject = useRejectAutomation();
  const cancel = useCancelAutomation();
  const retry = useRetryAutomation();
  const actionError = [approve.error, reject.error, cancel.error, retry.error].find(Boolean);
  const items = useMemo(() => automations.data ?? [], [automations.data]);
  const pendingApprovals = items.filter((automation) =>
    automation.approvals.some((approval) => approval.status === 'PENDING')
  );
  const matchingApprovals = pendingApprovals.filter((automation) => {
    const query = search.trim().toLowerCase();
    return !query || automation.title.toLowerCase().includes(query) || automation.goal.toLowerCase().includes(query);
  });
  const selectedApprovalAutomation =
    matchingApprovals.find((automation) => automation.id === selectedApprovalId) ?? matchingApprovals[0];
  const selectedApproval = selectedApprovalAutomation?.approvals.find(
    (approval) => approval.status === 'PENDING'
  );
  const actionPending = approve.isPending || reject.isPending || cancel.isPending || retry.isPending;

  const visibleAutomations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((automation) => {
      const matchesStatus = statusFilter === 'ALL' || automation.status === statusFilter;
      const matchesSearch =
        !query ||
        automation.title.toLowerCase().includes(query) ||
        automation.goal.toLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [items, search, statusFilter]);

  const displayedItems = view === 'history'
    ? visibleAutomations.filter((automation) =>
        ['COMPLETED', 'FAILED', 'CANCELED', 'REJECTED'].includes(automation.status)
      )
    : visibleAutomations;

  const createPlan = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    setCreatedAutomation(null);
    try {
      const created = await create.mutateAsync({ goal: goal.trim(), mode });
      setCreatedAutomation(created);
      setGoal('');
      setExpandedId(created.id);
      setView('workflows');
    } catch (error) {
      setFormError(getAutomationErrorMessage(error));
    }
  };

  const act = (operation: (id: string) => Promise<Automation>, id: string): void => {
    void operation(id).catch(() => undefined);
  };

  const shellProps = {
    title: 'Automation command center',
    description: 'Plan, approve, and track supported workflows',
    userName: user?.fullName ?? 'Your account',
    pendingApprovals: pendingApprovals.length,
  };

  return (
    <AutomationShell {...shellProps}>
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
            Workspace / Automation
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
            Your command center
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Turn a goal into a validated plan. Review the steps and results without leaving the
            workflow.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[11px] text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          Approval-aware · internal actions only
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <DashboardMetricCard
          label="Active workflows"
          value={
            automations.isLoading || automations.isError
              ? '—'
              : items.filter((item) => activeStatuses.includes(item.status)).length
          }
          detail="Awaiting approval, queued, or running"
          icon={Activity}
          tone="bg-indigo-400/10 text-indigo-300"
        />
        <DashboardMetricCard
          label="Pending approvals"
          value={automations.isLoading || automations.isError ? '—' : pendingApprovals.length}
          detail="Plans waiting for your decision"
          icon={ShieldCheck}
          tone="bg-amber-400/10 text-amber-300"
        />
        <DashboardMetricCard
          label="Completed workflows"
          value={
            automations.isLoading || automations.isError
              ? '—'
              : items.filter((item) => item.status === 'COMPLETED').length
          }
          detail="Confirmed by the automation service"
          icon={CheckCheck}
          tone="bg-emerald-400/10 text-emerald-300"
        />
        <DashboardMetricCard
          label="Failed workflows"
          value={
            automations.isLoading || automations.isError
              ? '—'
              : items.filter((item) => item.status === 'FAILED').length
          }
          detail="May be eligible for a bounded retry"
          icon={AlertCircle}
          tone="bg-rose-400/10 text-rose-300"
        />
      </div>

      <div className="mb-6 border-b border-white/[0.07]">
        <nav className="flex gap-5 overflow-x-auto" aria-label="Automation views">
          {viewOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setView(option.id)}
              aria-current={view === option.id ? 'page' : undefined}
              className={`relative -mb-px flex shrink-0 items-center gap-2 border-b-2 px-0.5 pb-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                view === option.id
                  ? 'border-indigo-400 text-indigo-200'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {option.label}
              {option.id === 'approvals' && pendingApprovals.length > 0 && (
                <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-200">
                  {pendingApprovals.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {view === 'command' && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.75fr)]">
          <div>
            <AutomationCommandInput
              value={goal}
              onChange={setGoal}
              onSubmit={(event) => void createPlan(event)}
              isPending={create.isPending}
              error={formError}
              mode={mode}
              onModeChange={setMode}
            />
            {create.isSuccess && createdAutomation && (
              <p className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-4 py-3 text-xs text-emerald-200" role="status">
                Plan confirmed by the server. Review “{createdAutomation.title}” in your workflows.
              </p>
            )}
          </div>

          <aside className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-5">
            <p className="text-xs font-semibold text-slate-200">What this MVP can do</p>
            <ul className="mt-4 space-y-3">
              <li className="flex gap-2.5 text-xs leading-5 text-slate-400">
                <FileSearch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                Read your latest saved completed code reviews.
              </li>
              <li className="flex gap-2.5 text-xs leading-5 text-slate-400">
                <ArrowDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                Create an internal draft from those results.
              </li>
              <li className="flex gap-2.5 text-xs leading-5 text-slate-400">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                Require server-verified approval for approval-mode workflows.
              </li>
            </ul>
            <div className="mt-5 rounded-lg border border-amber-400/15 bg-amber-400/[0.035] p-3">
              <p className="text-[11px] font-medium text-amber-100">No external publishing or writes</p>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">
                Live GitHub activity and LinkedIn publishing are not connected. Generated drafts
                and review text are not independently verified.
              </p>
            </div>
            <div className="mt-5 border-t border-white/[0.06] pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                Example goals
              </p>
              {automationExamples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setGoal(example)}
                  className="mt-2 flex w-full items-center justify-between gap-3 rounded-md py-1.5 text-left text-[11px] text-slate-400 transition hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <span>{example}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}

      {view === 'approvals' && (
        <section aria-labelledby="approval-heading">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 id="approval-heading" className="text-sm font-semibold text-white">Approval inbox</h3>
              <p className="mt-1 text-xs text-slate-500">
                Review the exact server-stored plan before approving internal execution.
              </p>
            </div>
            {pendingApprovals.length > 0 && (
              <label className="relative">
                <span className="sr-only">Search approval requests</span>
                <ListFilter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search approvals"
                  className="h-9 w-full rounded-lg border border-white/[0.08] bg-[#0e121b] pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-400/50 sm:w-56"
                />
              </label>
            )}
          </div>
          {automations.isLoading ? (
            <div className="flex items-center gap-2 py-10 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading approval requests…
            </div>
          ) : automations.isError ? (
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.04] p-5" role="alert">
              <p className="text-sm font-medium text-rose-200">Approval requests could not be loaded</p>
              <p className="mt-1 text-xs text-rose-200/70">{getAutomationErrorMessage(automations.error)}</p>
              <button
                type="button"
                onClick={() => void automations.refetch()}
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-rose-300/20 px-3 py-2 text-xs text-rose-100 hover:bg-rose-400/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
              </button>
            </div>
          ) : pendingApprovals.length === 0 ? (
            <EmptyPanel
              title="You’re all caught up"
              description="There are no pending plan approvals. This MVP does not support external publishing or writes."
            />
          ) : matchingApprovals.length === 0 ? (
            <EmptyPanel
              title="No matching approvals"
              description="Try a different search term to find a pending plan."
            />
          ) : (
            <div className="grid min-h-[440px] gap-4 lg:grid-cols-[minmax(250px,0.78fr)_minmax(0,1.7fr)]">
              <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#0e121b]">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                  <p className="text-xs font-semibold text-slate-300">Pending plans</p>
                  <span className="rounded-full bg-amber-400/[0.08] px-2 py-0.5 text-[10px] font-medium text-amber-200">
                    {pendingApprovals.length}
                  </span>
                </div>
                <div className="max-h-[560px] overflow-y-auto p-2">
                  {matchingApprovals.map((automation) => {
                    const approval = automation.approvals.find((item) => item.status === 'PENDING');
                    const selected = automation.id === selectedApprovalAutomation?.id;
                    return (
                      <button
                        key={automation.id}
                        type="button"
                        onClick={() => setSelectedApprovalId(automation.id)}
                        aria-pressed={selected}
                        className={`mb-1 w-full rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                          selected
                            ? 'border-indigo-400/25 bg-indigo-400/[0.07]'
                            : 'border-transparent hover:bg-white/[0.035]'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-slate-200">{automation.title}</span>
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" aria-label="Pending" />
                        </span>
                        <span className="mt-1.5 block line-clamp-2 text-[11px] leading-4 text-slate-500">
                          {approval?.summary ?? automation.goal}
                        </span>
                        <span className="mt-2 block text-[10px] text-slate-600">
                          {new Date(approval?.createdAt ?? automation.createdAt).toLocaleString()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedApprovalAutomation && selectedApproval ? (
                <article className="min-w-0 rounded-xl border border-white/[0.07] bg-[#0e121b]">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/75">
                        Plan approval · Internal actions only
                      </p>
                      <h4 className="mt-2 text-base font-semibold text-white">{selectedApprovalAutomation.title}</h4>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{selectedApproval.summary}</p>
                    </div>
                    <StatusBadge status={selectedApprovalAutomation.status} />
                  </div>
                  <div className="space-y-5 p-4 sm:p-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">Requested goal</p>
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-300">{selectedApproval.payload.goal}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">Expires</p>
                        <p className="mt-1 text-xs text-slate-300">{new Date(selectedApproval.expiresAt).toLocaleString()}</p>
                        <p className="mt-1 text-[10px] text-slate-600">
                          Plan created {new Date(selectedApproval.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                          Proposed task sequence
                        </p>
                        <span className="text-[10px] text-slate-600">
                          Approval fingerprint · {selectedApproval.payloadHash.slice(0, 12)}
                        </span>
                      </div>
                      <ol className="space-y-2">
                        {selectedApproval.payload.tasks.map((task, index) => (
                          <li key={task.key} className="rounded-lg border border-white/[0.06] bg-[#0a0d14] p-3">
                            <div className="flex items-start gap-3">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/[0.08] text-[10px] font-semibold text-slate-400">
                                {index + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-xs font-semibold text-slate-200">{task.title}</p>
                                  <span className="rounded-full bg-indigo-400/[0.08] px-2 py-0.5 text-[9px] text-indigo-200">
                                    {task.action.replace(/_/g, ' ')}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] leading-4 text-slate-500">{task.description}</p>
                                <ApprovalActionPreview action={task.action} input={task.input} />
                                {task.dependencies.length > 0 && (
                                  <p className="mt-1.5 text-[10px] text-slate-600">
                                    Depends on: {task.dependencies.join(', ')}
                                  </p>
                                )}
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-[10px] text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                                    Inspect task input
                                  </summary>
                                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/[0.06] bg-[#080b12] p-2.5 text-[10px] leading-4 text-slate-400">
                                    {JSON.stringify(task.input, null, 2)}
                                  </pre>
                                </details>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.035] p-3">
                      <p className="text-[11px] font-medium text-amber-100">What approval authorizes</p>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        Approval starts only the internal, read-only review collection and text-draft tasks shown above. No external post, message, repository change, or other write will be performed.
                      </p>
                    </div>

                    {actionError && (
                      <p className="rounded-lg border border-rose-400/20 bg-rose-400/[0.05] px-3 py-2 text-xs text-rose-200" role="alert">
                        {getAutomationErrorMessage(actionError)}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Approve "${selectedApprovalAutomation.title}"? This authorizes only the listed internal read and draft tasks. No external action will be performed.`
                            )
                          ) {
                            act(approve.mutateAsync, selectedApprovalAutomation.id);
                          }
                        }}
                        disabled={actionPending || new Date(selectedApproval.expiresAt).getTime() <= Date.now()}
                        className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-indigo-400 px-3 text-xs font-semibold text-slate-950 transition hover:bg-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Approve internal plan
                      </button>
                      <button
                        type="button"
                        onClick={() => act(reject.mutateAsync, selectedApprovalAutomation.id)}
                        disabled={actionPending}
                        className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-medium text-slate-300 transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        Reject plan
                      </button>
                    </div>
                  </div>
                </article>
              ) : null}
            </div>
          )}
        </section>
      )}

      {(view === 'workflows' || view === 'history') && (
        <section aria-labelledby="workflow-list-heading">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 id="workflow-list-heading" className="text-sm font-semibold text-white">
                {view === 'history' ? 'Execution history' : 'Your workflows'}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {view === 'history'
                  ? 'Completed and terminal workflow outcomes recorded by the service.'
                  : 'Inspect task order, status, outputs, attempts, and workflow events.'}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative">
                <span className="sr-only">Search workflows</span>
                <ListFilter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search workflows"
                  className="h-9 w-full rounded-lg border border-white/[0.08] bg-[#0e121b] pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-400/50 sm:w-48"
                />
              </label>
              <label>
                <span className="sr-only">Filter by workflow status</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as AutomationStatus | 'ALL')}
                  className="h-9 w-full rounded-lg border border-white/[0.08] bg-[#0e121b] px-3 text-xs text-slate-300 outline-none focus:border-indigo-400/50 sm:w-auto"
                >
                  <option value="ALL">All statuses</option>
                  {Object.keys(statusLabel).map((status) => (
                    <option key={status} value={status}>{statusLabel[status as AutomationStatus]}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {createdAutomation && view === 'workflows' && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-4 py-3 text-xs text-emerald-200" role="status">
              <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Plan created successfully: <strong>{createdAutomation.title}</strong>. The task plan below reflects the server response.</span>
            </div>
          )}

          {actionError && (
            <div className="mb-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.05] px-4 py-3 text-xs text-rose-200" role="alert">
              {getAutomationErrorMessage(actionError)}
            </div>
          )}
          {automations.isLoading && (
            <div className="flex items-center gap-2 py-10 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading workflows…
            </div>
          )}
          {automations.isError && (
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.04] p-5" role="alert">
              <p className="text-sm font-medium text-rose-200">Workflows could not be loaded</p>
              <p className="mt-1 text-xs text-rose-200/70">{getAutomationErrorMessage(automations.error)}</p>
              <button
                type="button"
                onClick={() => void automations.refetch()}
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-rose-300/20 px-3 py-2 text-xs text-rose-100 hover:bg-rose-400/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
              </button>
            </div>
          )}
          {!automations.isLoading && !automations.isError && displayedItems.length === 0 && (
            <EmptyPanel
              title={view === 'history' ? 'No execution history yet' : search || statusFilter !== 'ALL' ? 'No matching workflows' : 'No workflows yet'}
              description={
                view === 'history'
                  ? 'Workflow outcomes and task attempts will appear here after execution.'
                  : search || statusFilter !== 'ALL'
                    ? 'Try changing the search terms or status filter.'
                    : 'Describe a goal in the command tab to create your first reviewable plan.'
              }
            />
          )}
          <div className="space-y-3">
            {displayedItems.map((automation) => (
              <WorkflowCard
                key={automation.id}
                automation={automation}
                expanded={expandedId === automation.id}
                onToggle={() => setExpandedId(expandedId === automation.id ? null : automation.id)}
                onApprove={(id) => act(approve.mutateAsync, id)}
                onReject={(id) => act(reject.mutateAsync, id)}
                onCancel={(id) => act(cancel.mutateAsync, id)}
                onRetry={(id) => act(retry.mutateAsync, id)}
                pending={actionPending}
              />
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4 text-[10px] text-slate-600">
        <span>Execution updates refresh automatically while workflows are queued or running.</span>
        <Link to="/reviews" className="inline-flex items-center gap-1.5 text-slate-500 transition hover:text-slate-300">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> View code reviews
        </Link>
      </div>
    </AutomationShell>
  );
};
