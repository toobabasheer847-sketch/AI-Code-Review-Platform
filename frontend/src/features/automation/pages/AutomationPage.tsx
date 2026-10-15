import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { useMe } from '@/features/auth/hooks/useAuth';

import {
  getAutomationErrorMessage,
  type Automation,
  type AutomationMode,
  type AutomationTask,
} from '../api/automationApi';
import {
  useApproveAutomation,
  useAutomations,
  useCancelAutomation,
  useCreateAutomation,
  useRejectAutomation,
  useRetryAutomation,
} from '../hooks/useAutomations';

const buttonClass =
  'rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-100 transition hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50';

function DraftOutput({ task }: { task: AutomationTask }): JSX.Element | null {
  if (typeof task.output !== 'object' || task.output === null) return null;
  if ('draft' in task.output && typeof task.output.draft === 'string') {
    return (
      <div className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-200">
        {task.output.draft}
      </div>
    );
  }

  if (!('reviews' in task.output) || !Array.isArray(task.output.reviews)) return null;
  return (
    <details className="mt-3 rounded-lg border border-slate-700 bg-slate-950/70 p-4">
      <summary className="cursor-pointer text-sm text-indigo-200">
        Review results ({task.output.reviews.length})
      </summary>
      {'notice' in task.output && typeof task.output.notice === 'string' && (
        <p className="mt-2 text-sm text-slate-400">{task.output.notice}</p>
      )}
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-slate-300">
        {JSON.stringify(task.output.reviews, null, 2)}
      </pre>
    </details>
  );
}

function ApprovalCard({
  automation,
  onApprove,
  onReject,
  pending,
}: {
  automation: Automation;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  pending: boolean;
}): JSX.Element | null {
  const approval = automation.approvals.find((item) => item.status === 'PENDING');
  if (!approval) return null;

  return (
    <article className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">{approval.payload.title}</h3>
          <p className="mt-1 text-sm text-slate-300">{approval.summary}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">
            Goal: {approval.payload.goal}
          </p>
        </div>
        <span className="rounded-full border border-amber-400/30 px-3 py-1 text-xs text-amber-200">
          Pending · expires {new Date(approval.expiresAt).toLocaleString()}
        </span>
      </div>
      <ol className="mt-4 space-y-2">
        {approval.payload.tasks.map((task) => (
          <li key={task.key} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <p className="text-sm font-medium text-slate-100">{task.title}</p>
            <p className="mt-1 text-xs text-slate-400">{task.description}</p>
            <p className="mt-1 text-xs text-slate-500">Action: {task.action}</p>
            <p className="mt-1 text-xs text-slate-500">
              Target: No external action target; draft output stays in this workflow.
            </p>
            {task.dependencies.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Depends on: {task.dependencies.join(', ')}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Input: {JSON.stringify(task.input) || 'None'}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-slate-400">
        Approving starts only the listed internal, read-only and draft-generation tasks. This
        request cannot publish or change anything on GitHub, LinkedIn, or another external service.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          className={buttonClass}
          disabled={pending || new Date(approval.expiresAt).getTime() <= Date.now()}
          onClick={() => onApprove(automation.id)}
          type="button"
        >
          Approve plan
        </button>
        <button
          className={buttonClass}
          disabled={pending}
          onClick={() => onReject(automation.id)}
          type="button"
        >
          Reject
        </button>
      </div>
    </article>
  );
}

function AutomationCard({
  automation,
  onCancel,
  onRetry,
  pending,
}: {
  automation: Automation;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  pending: boolean;
}): JSX.Element {
  const canCancel = ['DRAFT', 'AWAITING_APPROVAL', 'QUEUED', 'RUNNING'].includes(automation.status);
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{automation.title}</h2>
          <p className="mt-1 text-xs text-slate-400">
            {automation.mode.replace(/_/g, ' ')} · {new Date(automation.createdAt).toLocaleString()}
          </p>
        </div>
        <span className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs font-medium text-indigo-200">
          {automation.status.replace(/_/g, ' ')}
        </span>
      </div>

      <p className="mt-4 whitespace-pre-wrap text-sm text-slate-300">{automation.goal}</p>
      {automation.approvals[0] && (
        <p className="mt-2 text-xs text-slate-500">
          Approval: {automation.approvals[0].status.toLowerCase()} · expires{' '}
          {new Date(automation.approvals[0].expiresAt).toLocaleString()}
          {automation.approvals[0].decidedAt &&
            ` · decided ${new Date(automation.approvals[0].decidedAt).toLocaleString()}`}
        </p>
      )}

      <ol className="mt-5 space-y-3">
        {automation.tasks.map((task) => (
          <li key={task.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-slate-100">{task.title}</h3>
              <span className="text-xs text-slate-400">
                {task.status.replace(/_/g, ' ')} · {task.action} · attempts {task.attempts}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">{task.description}</p>
            {task.dependencies.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Depends on: {task.dependencies.join(', ')}
              </p>
            )}
            {task.errorMessage && (
              <p className="mt-2 text-sm text-rose-300" role="alert">
                {task.errorMessage}
              </p>
            )}
            <DraftOutput task={task} />
            {task.executionAttempts.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-slate-400">
                  Attempt history ({task.executionAttempts.length})
                </summary>
                <ol className="mt-2 space-y-2">
                  {task.executionAttempts.map((attempt) => (
                    <li
                      key={attempt.id}
                      className="rounded border border-slate-800 p-3 text-xs text-slate-400"
                    >
                      Attempt {attempt.attemptNumber} · {attempt.status.toLowerCase()} ·{' '}
                      {new Date(attempt.startedAt).toLocaleString()}
                      {attempt.errorMessage && (
                        <p className="mt-1 text-rose-300">{attempt.errorMessage}</p>
                      )}
                      {attempt.output !== null && (
                        <pre className="mt-2 whitespace-pre-wrap text-slate-300">
                          {JSON.stringify(attempt.output, null, 2)}
                        </pre>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap gap-2">
        {automation.status === 'FAILED' && (
          <button
            className={buttonClass}
            disabled={pending}
            onClick={() => onRetry(automation.id)}
            type="button"
          >
            Retry
          </button>
        )}
        {canCancel && (
          <button
            className={buttonClass}
            disabled={pending}
            onClick={() => onCancel(automation.id)}
            type="button"
          >
            Cancel
          </button>
        )}
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-indigo-300">Execution history</summary>
        <ol className="mt-3 space-y-2 border-l border-slate-700 pl-4">
          {automation.events.map((event) => (
            <li key={event.id} className="text-sm text-slate-400">
              <time className="mr-2 text-xs text-slate-500">
                {new Date(event.createdAt).toLocaleString()}
              </time>
              {event.message}
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}

export const AutomationPage = (): JSX.Element => {
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<AutomationMode>('APPROVAL_REQUIRED');
  const [formError, setFormError] = useState<string | null>(null);
  const { data: user } = useMe();
  const automations = useAutomations();
  const create = useCreateAutomation();
  const approve = useApproveAutomation();
  const reject = useRejectAutomation();
  const cancel = useCancelAutomation();
  const retry = useRetryAutomation();
  const actionError = [approve.error, reject.error, cancel.error, retry.error].find(Boolean);

  const createPlan = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    try {
      await create.mutateAsync({ goal: goal.trim(), mode });
      setGoal('');
    } catch (error) {
      setFormError(getAutomationErrorMessage(error));
    }
  };

  const act = (operation: (id: string) => Promise<Automation>, id: string): void => {
    void operation(id).catch(() => undefined);
  };

  const actionPending =
    approve.isPending || reject.isPending || cancel.isPending || retry.isPending;

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Link to="/dashboard" className="text-sm text-indigo-300 hover:text-indigo-200">
          &larr; Dashboard
        </Link>
        <header className="mt-5">
          <h1 className="text-3xl font-bold text-white">Automation Command Center</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Turn a goal into a reviewable plan. This MVP can read your completed code-review results
            and generate internal drafts; it cannot publish content, modify repositories, run code,
            or call external actions.
          </p>
        </header>

        <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="text-lg font-semibold text-white">Create a plan</h2>
          <form className="mt-4 space-y-4" onSubmit={(event) => void createPlan(event)}>
            <label className="block text-sm text-slate-300" htmlFor="automation-goal">
              Natural-language goal
            </label>
            <textarea
              id="automation-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              maxLength={2000}
              required
              rows={4}
              placeholder="For example: Draft a concise technical update about my recent project work."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm text-slate-300" htmlFor="automation-mode">
                Execution mode
                <select
                  id="automation-mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as AutomationMode)}
                  className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="DRAFT_ONLY">Draft only — do not execute</option>
                  <option value="APPROVAL_REQUIRED">
                    Approval required before internal execution
                  </option>
                  <option value="AUTO_LOW_RISK">Automatically run internal read/draft tasks</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={goal.trim().length === 0 || create.isPending}
                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {create.isPending ? 'Planning…' : 'Generate plan'}
              </button>
            </div>
            {mode === 'DRAFT_ONLY' && (
              <p className="text-xs text-slate-400">
                Draft-only plans are saved for review and cannot be executed in this MVP.
              </p>
            )}
            {mode === 'APPROVAL_REQUIRED' && (
              <p className="text-xs text-slate-400">
                Approval requests expire after 7 days. All external actions remain unavailable in
                this MVP.
              </p>
            )}
            {create.isSuccess && (
              <p className="text-sm text-emerald-300" role="status">
                Plan created. Review its steps below
                {mode === 'APPROVAL_REQUIRED' ? ' and decide in the approval inbox' : ''}.
              </p>
            )}
            {formError && (
              <p className="text-sm text-rose-300" role="alert">
                {formError}
              </p>
            )}
          </form>
        </section>

        <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/30 p-4">
          <h2 className="font-semibold text-white">Integration status</h2>
          <p className="mt-1 text-sm text-slate-400">
            GitHub: {user?.githubConnected ? 'Connected' : 'Not connected'}. Automations use saved,
            completed code-review results only; they do not fetch live repository activity.
          </p>
          <p className="mt-1 text-sm text-slate-400">
            LinkedIn: Not configured. Drafting is internal; publishing is unavailable and requires
            provider credentials and permissions.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Draft generation sends your goal and selected saved review text to the configured OpenAI
            provider. Review findings are not independently verified.
          </p>
        </section>

        <section className="mt-8 space-y-4" aria-labelledby="approval-inbox-title">
          <h2 id="approval-inbox-title" className="text-xl font-semibold text-white">
            Approval inbox
          </h2>
          {automations.data?.filter((automation) =>
            automation.approvals.some((approval) => approval.status === 'PENDING')
          ).length === 0 && (
            <p className="rounded-xl border border-slate-800 p-5 text-sm text-slate-400">
              No pending approvals. External actions are not supported by this MVP.
            </p>
          )}
          {automations.data
            ?.filter((automation) =>
              automation.approvals.some((approval) => approval.status === 'PENDING')
            )
            .map((automation) => (
              <ApprovalCard
                key={automation.id}
                automation={automation}
                pending={actionPending}
                onApprove={(id) => act(approve.mutateAsync, id)}
                onReject={(id) => act(reject.mutateAsync, id)}
              />
            ))}
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold text-white">Your workflows</h2>
          {actionError && (
            <p
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200"
              role="alert"
            >
              {getAutomationErrorMessage(actionError)}
            </p>
          )}
          {automations.isLoading && <p className="text-sm text-slate-400">Loading workflows…</p>}
          {automations.isError && (
            <p className="text-sm text-rose-300" role="alert">
              {getAutomationErrorMessage(automations.error)}
            </p>
          )}
          {automations.data?.length === 0 && (
            <p className="rounded-xl border border-slate-800 p-6 text-sm text-slate-400">
              No automation plans yet. Create a goal above to get started.
            </p>
          )}
          {automations.data?.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              pending={actionPending}
              onCancel={(id) => act(cancel.mutateAsync, id)}
              onRetry={(id) => act(retry.mutateAsync, id)}
            />
          ))}
        </section>
      </main>
    </div>
  );
};
