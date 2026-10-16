import {
  Activity,
  ArrowRight,
  CheckCheck,
  AlertCircle,
  Clock3,
  FileSearch,
  Github,
  Loader2,
  ShieldCheck,
  Workflow,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useMe } from '@/features/auth/hooks/useAuth'
import { automationApi, getAutomationErrorMessage, type Automation, type AutomationMode } from '@/features/automation/api/automationApi'
import { AutomationCommandInput } from '@/features/automation/components/AutomationCommandInput'
import { AutomationShell } from '@/features/automation/components/AutomationShell'
import { DashboardMetricCard } from '@/features/automation/components/DashboardMetricCard'
import { useAutomations } from '@/features/automation/hooks/useAutomations'
import { ConnectGitHubButton } from '@/features/github/components/ConnectGitHubButton'
import type { ReviewSummary } from '@/features/reviews/api/reviewApi'
import { useListReviews } from '@/features/reviews/hooks/useReviews'

function RecentReview({ review }: { review: ReviewSummary }): JSX.Element {
  return (
    <Link
      to={`/reviews/${review.id}`}
      className="flex items-center gap-3 rounded-lg px-3 py-3 transition hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.025] text-slate-500">
        <FileSearch className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-slate-300">{review.repository}</span>
        <span className="mt-1 block text-[10px] text-slate-600">
          {review.issues} {review.issues === 1 ? 'finding' : 'findings'} · {new Date(review.createdAt).toLocaleDateString()}
        </span>
      </span>
      <span className={`rounded-full px-2 py-1 text-[9px] ${
        review.status === 'completed'
          ? 'bg-emerald-400/[0.08] text-emerald-300'
          : review.status === 'failed'
            ? 'bg-rose-400/[0.08] text-rose-300'
            : 'bg-sky-400/[0.08] text-sky-300'
      }`}>
        {review.status}
      </span>
    </Link>
  )
}

export const DashboardPage = (): JSX.Element => {
  const { data: user, refetch: refetchMe } = useMe()
  const [searchParams, setSearchParams] = useSearchParams()
  const justConnected = searchParams.get('connected') === 'true'
  const automations = useAutomations()
  const reviews = useListReviews()
  const [goal, setGoal] = useState('')
  const [mode, setMode] = useState<AutomationMode>('APPROVAL_REQUIRED')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<Automation | null>(null)
  const navigate = useNavigate()
  const items = automations.data ?? []
  const reviewItems = reviews.data ?? []
  const pendingApprovals = items.filter((automation) =>
    automation.approvals.some((approval) => approval.status === 'PENDING')
  ).length
  const runningTasks = items.flatMap((automation) =>
    automation.tasks
      .filter((task) => task.status === 'RUNNING')
      .map((task) => ({ ...task, workflowTitle: automation.title, workflowId: automation.id }))
  )

  useEffect(() => {
    if (justConnected) {
      void refetchMe()
      const updatedParams = new URLSearchParams(searchParams)
      updatedParams.delete('connected')
      setSearchParams(updatedParams, { replace: true })
    }
  }, [justConnected, refetchMe, searchParams, setSearchParams])

  const createPlan = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFormError(null)
    setSuccess(null)
    try {
      const created = await automationApi.create(goal.trim(), mode, crypto.randomUUID())
      setSuccess(created)
      setGoal('')
      await automations.refetch()
    } catch (error) {
      setFormError(getAutomationErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AutomationShell
      title="Overview"
      description="Your reviews and automation activity at a glance"
      userName={user?.fullName ?? 'Your account'}
      pendingApprovals={pendingApprovals}
    >
      <div className="mb-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
          Workspace / Overview
        </p>
        <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
              Welcome back, {user?.fullName?.split(' ')[0] ?? 'there'}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Your code reviews and supported automation workflows, together in one place.
            </p>
          </div>
          {justConnected && (
            <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-3 py-2 text-xs text-emerald-200" role="status">
              GitHub account connected successfully.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <DashboardMetricCard
          label="Active workflows"
          value={automations.isLoading || automations.isError ? '—' : items.filter((item) => ['AWAITING_APPROVAL', 'QUEUED', 'RUNNING'].includes(item.status)).length}
          icon={Workflow}
          tone="bg-indigo-400/10 text-indigo-300"
        />
        <DashboardMetricCard
          label="Pending approvals"
          value={automations.isLoading || automations.isError ? '—' : pendingApprovals}
          icon={ShieldCheck}
          tone="bg-amber-400/10 text-amber-300"
        />
        <DashboardMetricCard
          label="Completed workflows"
          value={automations.isLoading || automations.isError ? '—' : items.filter((item) => item.status === 'COMPLETED').length}
          icon={CheckCheck}
          tone="bg-emerald-400/10 text-emerald-300"
        />
        <DashboardMetricCard
          label="Failed workflows"
          value={automations.isLoading || automations.isError ? '—' : items.filter((item) => item.status === 'FAILED').length}
          icon={AlertCircle}
          tone="bg-rose-400/10 text-rose-300"
        />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <div>
          <AutomationCommandInput
            value={goal}
            onChange={setGoal}
            onSubmit={(event) => void createPlan(event)}
            isPending={submitting}
            error={formError}
            mode={mode}
            onModeChange={setMode}
          />
          {success && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-4 py-3 text-xs text-emerald-200" role="status">
              <span>Plan confirmed by the server: <strong>{success.title}</strong></span>
              <button
                type="button"
                onClick={() => navigate(`/automations?view=workflows&workflow=${success.id}`)}
                className="inline-flex items-center gap-1 font-medium hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              >
                Inspect workflow <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <section className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-200">GitHub connection</h3>
              <p className="mt-1 text-[11px] text-slate-500">
                {user?.githubConnected
                  ? `Connected as ${user.githubUsername ?? 'GitHub user'}`
                  : 'Connect to access repository review features.'}
              </p>
            </div>
            <Github className="h-5 w-5 text-slate-500" aria-hidden="true" />
          </div>
          <div className="mt-4">
            {user?.githubConnected ? (
              <Link
                to="/github/repos"
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.08] px-3 text-xs font-medium text-slate-300 transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                View repositories <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ) : (
              <ConnectGitHubButton className="rounded-lg" />
            )}
          </div>
          <p className="mt-4 border-t border-white/[0.06] pt-3 text-[10px] leading-4 text-slate-600">
            Automation reads saved completed reviews only; it does not fetch live repository activity.
          </p>
        </section>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4 sm:p-5" aria-labelledby="recent-automation-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 id="recent-automation-title" className="text-sm font-semibold text-slate-200">Recent workflows</h3>
              <p className="mt-1 text-[10px] text-slate-600">Latest status from your automation runs</p>
            </div>
            <Link to="/automations?view=workflows" className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-300 hover:text-indigo-200">
              View all <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
          {automations.isLoading ? (
            <p className="mt-6 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading workflows…</p>
          ) : automations.isError ? (
            <p className="mt-6 text-xs text-rose-300" role="alert">{getAutomationErrorMessage(automations.error)}</p>
          ) : items.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-white/[0.08] px-4 py-6 text-center">
              <Workflow className="mx-auto h-5 w-5 text-slate-600" aria-hidden="true" />
              <p className="mt-2 text-xs text-slate-400">No workflows yet</p>
              <p className="mt-1 text-[10px] text-slate-600">Create a plan above to get started.</p>
            </div>
          ) : (
            <div className="mt-3 divide-y divide-white/[0.05]">
              {items.slice(0, 4).map((automation) => (
                <Link
                  key={automation.id}
                  to={`/automations?view=workflows&workflow=${automation.id}`}
                  className="flex items-center gap-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-400/[0.08] text-indigo-300">
                    <Workflow className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-300">{automation.title}</span>
                    <span className="mt-1 block text-[10px] text-slate-600">{new Date(automation.createdAt).toLocaleString()}</span>
                  </span>
                  <span className={`rounded-full px-2 py-1 text-[9px] ${
                    automation.status === 'COMPLETED' ? 'bg-emerald-400/[0.08] text-emerald-300'
                      : automation.status === 'FAILED' || automation.status === 'REJECTED' ? 'bg-rose-400/[0.08] text-rose-300'
                        : automation.status === 'AWAITING_APPROVAL' ? 'bg-amber-400/[0.08] text-amber-200'
                          : 'bg-slate-400/[0.08] text-slate-400'
                  }`}>
                    {automation.status.replace(/_/g, ' ').toLowerCase()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4 sm:p-5" aria-labelledby="recent-reviews-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 id="recent-reviews-title" className="text-sm font-semibold text-slate-200">Recent code reviews</h3>
              <p className="mt-1 text-[10px] text-slate-600">Activity from your saved review history</p>
            </div>
            <Link to="/reviews" className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-300 hover:text-indigo-200">
              View all <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
          {reviews.isLoading ? (
            <p className="mt-6 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading reviews…</p>
          ) : reviews.isError ? (
            <p className="mt-6 text-xs text-rose-300" role="alert">{getAutomationErrorMessage(reviews.error)}</p>
          ) : reviewItems.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-white/[0.08] px-4 py-6 text-center">
              <FileSearch className="mx-auto h-5 w-5 text-slate-600" aria-hidden="true" />
              <p className="mt-2 text-xs text-slate-400">No code reviews yet</p>
              <p className="mt-1 text-[10px] text-slate-600">Start a repository review to see its results here.</p>
            </div>
          ) : (
            <div className="mt-3 divide-y divide-white/[0.05]">
              {reviewItems.slice(0, 4).map((review) => <RecentReview key={review.id} review={review} />)}
            </div>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-white/[0.07] bg-[#0e121b] p-4 sm:p-5" aria-labelledby="running-tasks-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 id="running-tasks-title" className="text-sm font-semibold text-slate-200">Running tasks</h3>
            <p className="mt-1 text-[10px] text-slate-600">Task state reported by the execution worker</p>
          </div>
          <Clock3 className="h-4 w-4 text-slate-600" aria-hidden="true" />
        </div>
        {runningTasks.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">No tasks are running right now.</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {runningTasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-[#0a0d14] p-3">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-300" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-slate-300">{task.title}</span>
                  <Link to={`/automations?view=workflows&workflow=${task.workflowId}`} className="mt-1 block truncate text-[10px] text-slate-600 hover:text-indigo-300">
                    {task.workflowTitle}
                  </Link>
                </span>
                <Activity className="h-3.5 w-3.5 text-indigo-300/70" aria-hidden="true" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 flex items-start gap-2 text-[10px] leading-4 text-slate-600">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500/70" aria-hidden="true" />
        Automation drafts use saved review content as untrusted source material. LinkedIn and live
        GitHub activity are not connected; no external action is performed.
      </p>
    </AutomationShell>
  )
}
