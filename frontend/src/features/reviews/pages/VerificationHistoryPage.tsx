import { useQuery } from '@tanstack/react-query'
import { AlertCircle, CheckCheck, Clock3, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useMe } from '@/features/auth/hooks/useAuth'
import { AutomationShell } from '@/features/automation/components/AutomationShell'
import { DashboardMetricCard } from '@/features/automation/components/DashboardMetricCard'
import { reviewApi, type FixVerificationAttempt } from '@/features/reviews/api/reviewApi'

const statusLabels: Record<FixVerificationAttempt['status'], string> = {
  RUNNING: 'Running',
  VERIFIED: 'Verified',
  FAILED: 'Failed',
  NEEDS_REVIEW: 'Needs review',
}

export const VerificationHistoryPage = (): JSX.Element => {
  const { data: user } = useMe()
  const [status, setStatus] = useState<FixVerificationAttempt['status'] | ''>('')
  const [repositoryId, setRepositoryId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const filters = {
    ...(status ? { status } : {}),
    ...(repositoryId ? { repositoryId } : {}),
    ...(from ? { from: new Date(`${from}T00:00:00.000Z`).toISOString() } : {}),
    ...(to ? { to: new Date(`${to}T23:59:59.999Z`).toISOString() } : {}),
  }
  const history = useQuery({
    queryKey: ['fix-verifications', filters],
    queryFn: () => reviewApi.listFixVerifications(filters),
  })
  const data = history.data

  return (
    <AutomationShell
      title="Fix verification"
      description="Evidence and review history for proposed fixes"
      userName={user?.fullName ?? 'Your account'}
      pendingApprovals={0}
    >
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
          Workspace / Verification
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
          AI fix verification
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          Each result is bound to the finding, patch, repository revision, and checks actually
          executed. Missing execution evidence remains Needs review.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <DashboardMetricCard
          label="Verification runs"
          value={history.isLoading || history.isError ? '—' : (data?.total ?? 0)}
          icon={Clock3}
          tone="bg-indigo-400/10 text-indigo-300"
        />
        <DashboardMetricCard
          label="Verified fixes"
          value={history.isLoading || history.isError ? '—' : (data?.verified ?? 0)}
          icon={CheckCheck}
          tone="bg-emerald-400/10 text-emerald-300"
        />
        <DashboardMetricCard
          label="Failed fixes"
          value={history.isLoading || history.isError ? '—' : (data?.failed ?? 0)}
          icon={AlertCircle}
          tone="bg-rose-400/10 text-rose-300"
        />
        <DashboardMetricCard
          label="Needs review"
          value={history.isLoading || history.isError ? '—' : (data?.needsReview ?? 0)}
          icon={ShieldCheck}
          tone="bg-amber-400/10 text-amber-300"
        />
      </div>

      <section className="mt-6 rounded-xl border border-white/[0.07] bg-[#0e121b] p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-slate-400">
            Status
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as FixVerificationAttempt['status'] | '')
              }
              className="mt-1 block min-h-10 w-full rounded-lg border border-white/[0.1] bg-[#0a0d14] px-3 text-sm text-slate-200"
            >
              <option value="">All statuses</option>
              <option value="VERIFIED">Verified</option>
              <option value="FAILED">Failed</option>
              <option value="NEEDS_REVIEW">Needs review</option>
              <option value="RUNNING">Running</option>
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Repository
            <select
              value={repositoryId}
              onChange={(event) => setRepositoryId(event.target.value)}
              className="mt-1 block min-h-10 w-full rounded-lg border border-white/[0.1] bg-[#0a0d14] px-3 text-sm text-slate-200"
            >
              <option value="">All repositories</option>
              {(data?.repositories ?? []).map((repository) => (
                <option key={repository.id} value={repository.id}>
                  {repository.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            From
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 block min-h-10 w-full rounded-lg border border-white/[0.1] bg-[#0a0d14] px-3 text-sm text-slate-200"
            />
          </label>
          <label className="text-xs text-slate-400">
            To
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1 block min-h-10 w-full rounded-lg border border-white/[0.1] bg-[#0a0d14] px-3 text-sm text-slate-200"
            />
          </label>
        </div>
      </section>

      {history.isLoading && (
        <p className="mt-6 text-sm text-slate-400" role="status">
          Loading verification evidence…
        </p>
      )}
      {history.isError && (
        <p className="mt-6 text-sm text-rose-300" role="alert">
          {history.error.message || 'Unable to load verification evidence.'}
        </p>
      )}
      {data && data.runs.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-white/[0.1] p-8 text-center text-sm text-slate-500">
          No verification attempts match these filters.
        </p>
      )}

      <ol className="mt-5 space-y-3">
        {data?.runs.map((run) => (
          <li
            key={run.id}
            className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">
                  {run.findingSeverity} · {run.repositoryName}
                  {run.pullRequestNumber ? ` · PR #${run.pullRequestNumber}` : ''}
                </p>
                <h3 className="mt-1 text-sm font-semibold text-slate-100">{run.findingTitle}</h3>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {run.findingFile} · {run.branch}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs ${
                  run.status === 'VERIFIED'
                    ? 'bg-emerald-400/10 text-emerald-300'
                    : run.status === 'FAILED'
                      ? 'bg-rose-400/10 text-rose-300'
                      : 'bg-amber-400/10 text-amber-200'
                }`}
              >
                {statusLabels[run.status]}
              </span>
            </div>

            <dl className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
              <div>
                <dt className="inline text-slate-500">Commit: </dt>
                <dd className="inline font-mono">{run.commitSha ?? 'Unavailable'}</dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Execution: </dt>
                <dd className="inline">
                  {run.executionDurationMs} ms
                  {run.exitCode === null ? '' : ` · exit ${run.exitCode}`}
                </dd>
              </div>
            </dl>

            {run.checkResults.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {run.checkResults.map((check, index) => (
                  <li key={`${run.id}-check-${index}`} className="text-xs text-slate-400">
                    {check.name}: {check.status} · {check.durationMs} ms
                    {check.exitCode === null ? '' : ` · exit ${check.exitCode}`}
                    {check.failureDetails && (
                      <p className="mt-1 whitespace-pre-wrap text-rose-300">
                        {check.failureDetails}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-amber-200">
                No test checks were executed for this attempt.
              </p>
            )}

            {run.failureDetails && (
              <p className="mt-3 whitespace-pre-wrap text-xs text-rose-300">{run.failureDetails}</p>
            )}
            {run.humanReviewDecision && (
              <p className="mt-3 text-xs text-slate-400">
                Human decision: {run.humanReviewDecision.replace(/_/g, ' ')}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
              <time className="text-[10px] text-slate-600" dateTime={run.startedAt}>
                {new Date(run.startedAt).toLocaleString()}
              </time>
              <Link
                to={`/reviews/${run.reviewId}`}
                className="text-xs font-medium text-indigo-300 hover:text-indigo-200"
              >
                Open finding and history
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </AutomationShell>
  )
}
