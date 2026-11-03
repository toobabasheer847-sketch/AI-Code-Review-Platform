import { useQuery } from '@tanstack/react-query'
import { BarChart3, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useMe } from '@/features/auth/hooks/useAuth'
import { AutomationShell } from '@/features/automation/components/AutomationShell'
import { DashboardMetricCard } from '@/features/automation/components/DashboardMetricCard'
import { repositoryApi } from '@/features/repositories/api/repositoryApi'
import { reviewApi, type FeedbackAnalytics } from '@/features/reviews/api/reviewApi'

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`
}

function apiErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = error.response
    if (
      response &&
      typeof response === 'object' &&
      'data' in response &&
      response.data &&
      typeof response.data === 'object' &&
      'error' in response.data &&
      typeof response.data.error === 'string'
    ) {
      return response.data.error
    }
  }
  return error instanceof Error ? error.message : 'Unable to load feedback analytics.'
}

export const FeedbackAnalyticsPage = (): JSX.Element => {
  const { data: user } = useMe()
  const [params, setParams] = useSearchParams()
  const repositoryId = params.get('repositoryId') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const repositories = useQuery({
    queryKey: ['repositories'],
    queryFn: () => repositoryApi.list(),
  })
  const analytics = useQuery({
    queryKey: ['feedback-analytics', repositoryId, from, to],
    queryFn: () =>
      reviewApi.getFeedbackAnalytics({
        repositoryId,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
    enabled: repositoryId.length > 0,
  })

  const applyFilters = (nextRepositoryId: string): void => {
    const next = new URLSearchParams()
    if (nextRepositoryId) next.set('repositoryId', nextRepositoryId)
    if (draftFrom) next.set('from', draftFrom)
    if (draftTo) next.set('to', draftTo)
    setParams(next)
  }

  const data = analytics.data
  const repositoryName =
    repositories.data?.find((repository) => repository.id === repositoryId)?.name ?? 'Repository'

  return (
    <AutomationShell
      title="Feedback analytics"
      description="User assessments and objective verification for one repository"
      userName={user?.fullName ?? 'Your account'}
      pendingApprovals={0}
    >
      <div className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
          Reviews / Feedback analytics
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Repository feedback</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          User-assessed feedback is a developer judgment. Objectively verified findings come only
          from verification records. Unreviewed AI findings stay unassessed.
        </p>
      </div>

      <form
        className="mb-6 grid gap-3 rounded-xl border border-white/[0.07] bg-[#0e121b] p-4 md:grid-cols-[minmax(0,1.4fr)_160px_160px_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          applyFilters(repositoryId)
        }}
      >
        <label className="text-xs text-slate-400">
          Repository
          <select
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#080b12] px-3 py-2 text-sm text-white"
            value={repositoryId}
            onChange={(event) => applyFilters(event.target.value)}
          >
            <option value="">Select a repository</option>
            {(repositories.data ?? []).map((repository) => (
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
            value={draftFrom}
            onChange={(event) => setDraftFrom(event.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#080b12] px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="text-xs text-slate-400">
          To
          <input
            type="date"
            value={draftTo}
            onChange={(event) => setDraftTo(event.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#080b12] px-3 py-2 text-sm text-white"
          />
        </label>
        <button
          type="submit"
          className="self-end rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
        >
          Apply dates
        </button>
      </form>

      {repositories.isLoading && (
        <p className="text-sm text-slate-400" role="status">
          Loading repositories...
        </p>
      )}
      {repositories.isError && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4" role="alert">
          <p className="text-sm text-rose-100">Repositories could not be loaded.</p>
          <button
            type="button"
            className="mt-3 rounded-lg border border-rose-300/30 px-3 py-2 text-sm text-rose-50"
            onClick={() => void repositories.refetch()}
          >
            Try again
          </button>
        </div>
      )}
      {repositories.isSuccess && repositories.data.length === 0 && (
        <div className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-8 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-slate-500" aria-hidden="true" />
          <h3 className="mt-3 text-base font-medium text-white">No reviewed repositories yet</h3>
          <p className="mt-2 text-sm text-slate-400">
            Feedback analytics appear after a repository has been reviewed in AI CodeGuard.
          </p>
        </div>
      )}
      {repositories.isSuccess && repositories.data.length > 0 && !repositoryId && (
        <div className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-8 text-center">
          <h3 className="text-base font-medium text-white">Choose a repository</h3>
          <p className="mt-2 text-sm text-slate-400">
            Analytics stay scoped to one repository you own.
          </p>
        </div>
      )}
      {repositoryId && analytics.isLoading && (
        <p className="text-sm text-slate-400" role="status">
          Loading feedback analytics...
        </p>
      )}
      {repositoryId && analytics.isError && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4" role="alert">
          <p className="text-sm text-rose-100">{apiErrorMessage(analytics.error)}</p>
          <button
            type="button"
            className="mt-3 rounded-lg border border-rose-300/30 px-3 py-2 text-sm text-rose-50"
            onClick={() => void analytics.refetch()}
          >
            Try again
          </button>
        </div>
      )}
      {data && <AnalyticsBody data={data} repositoryName={repositoryName} repositoryId={repositoryId} />}
    </AutomationShell>
  )
}

function AnalyticsBody({
  data,
  repositoryName,
  repositoryId,
}: {
  data: FeedbackAnalytics
  repositoryName: string
  repositoryId: string
}): JSX.Element {
  const rateText = data.rates
    ? `True positive ${percent(data.rates.truePositive)} of ${data.rates.sampleSize} assessed findings`
    : data.ratesWithheldReason

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.04] p-4 text-sm text-sky-100">
        <p>{data.distinctions.userAssessments}</p>
        <p className="mt-2">{data.distinctions.objectiveVerification}</p>
        <p className="mt-2">{data.distinctions.unassessedFindings}</p>
      </div>

      {data.findings.total === 0 ? (
        <div className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-8 text-center">
          <h3 className="text-base font-medium text-white">No findings in this range</h3>
          <p className="mt-2 text-sm text-slate-400">
            {repositoryName} has no findings for the selected dates. Counts stay at zero instead of
            showing a success rate.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <DashboardMetricCard label="Total findings" value={data.findings.total} icon={BarChart3} tone="bg-indigo-400/10 text-indigo-300" />
            <DashboardMetricCard label="User-assessed true positives" value={data.findings.userAssessedTruePositives} icon={ShieldCheck} tone="bg-emerald-400/10 text-emerald-300" detail="Developer judgment" />
            <DashboardMetricCard label="User-assessed false positives" value={data.findings.userAssessedFalsePositives} icon={ShieldCheck} tone="bg-amber-400/10 text-amber-300" detail="Developer judgment" />
            <DashboardMetricCard label="Already fixed" value={data.findings.alreadyFixed} icon={ShieldCheck} tone="bg-sky-400/10 text-sky-300" detail="User assessment" />
            <DashboardMetricCard label="Needs review" value={data.findings.needsReview} icon={ShieldCheck} tone="bg-violet-400/10 text-violet-300" detail="User assessment" />
            <DashboardMetricCard label="Unassessed" value={data.findings.unassessed} icon={ShieldCheck} tone="bg-slate-400/10 text-slate-300" detail="Not a true or false positive" />
            <DashboardMetricCard label="Objectively verified" value={data.objectiveVerification.verified} icon={ShieldCheck} tone="bg-emerald-400/10 text-emerald-300" detail="Verification record: VERIFIED" />
            <DashboardMetricCard label="AI reported only" value={data.objectiveVerification.aiReportedOnly} icon={BarChart3} tone="bg-slate-400/10 text-slate-300" detail="Not confirmed" />
          </div>
          <p className="text-sm text-slate-300">{rateText}</p>
          <p className="text-xs text-slate-500">
            Verification failed: {data.objectiveVerification.verificationFailed}. Inconclusive:{' '}
            {data.objectiveVerification.inconclusive}. Independently verified fixes:{' '}
            {data.objectiveVerification.independentlyVerifiedFixes}. {data.distinctions.verificationFailure}{' '}
            {data.distinctions.verifiedFix}
          </p>
        </>
      )}

      <section className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4">
        <h3 className="text-sm font-medium text-white">Feedback events over time</h3>
        <p className="mt-1 text-xs text-slate-500">{data.trends.note}</p>
        {data.trends.points.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">No assessment events in this range.</p>
        ) : (
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trends.points}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={12} />
                <Tooltip />
                <Legend />
                <Line dataKey="truePositive" name="True positive" stroke="#34d399" />
                <Line dataKey="falsePositive" name="False positive" stroke="#fbbf24" />
                <Line dataKey="alreadyFixed" name="Already fixed" stroke="#38bdf8" />
                <Line dataKey="needsReview" name="Needs review" stroke="#a78bfa" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <DistributionChart title="Feedback by category" rows={data.distributionByCategory} />
        <DistributionChart title="Feedback by severity" rows={data.distributionBySeverity} />
      </div>

      <section className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4">
        <h3 className="text-sm font-medium text-white">Review and repository quality</h3>
        <p className="mt-2 text-sm text-slate-300">
          {data.repositoryTrend.reviewCount} reviews. Average stored quality score:{' '}
          {data.repositoryTrend.qualityScoreAverage === null
            ? data.repositoryTrend.qualityScoreAverageWithheldReason
            : data.repositoryTrend.qualityScoreAverage.toFixed(1)}
        </p>
        {data.reviewTrends.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No reviews in this range.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Review</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Findings</th>
                  <th className="py-2 pr-3">True</th>
                  <th className="py-2 pr-3">False</th>
                  <th className="py-2 pr-3">Unassessed</th>
                  <th className="py-2">Verified</th>
                </tr>
              </thead>
              <tbody>
                {data.reviewTrends.map((review) => (
                  <tr key={review.reviewId} className="border-t border-white/[0.06]">
                    <td className="py-2 pr-3">
                      <Link className="text-indigo-300 hover:text-indigo-200" to={`/reviews/${review.reviewId}`}>
                        {review.createdAt.slice(0, 10)}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{review.qualityScore ?? 'Not recorded'}</td>
                    <td className="py-2 pr-3">{review.totalFindings}</td>
                    <td className="py-2 pr-3">{review.userAssessedTruePositives}</td>
                    <td className="py-2 pr-3">{review.userAssessedFalsePositives}</td>
                    <td className="py-2 pr-3">{review.unassessed}</td>
                    <td className="py-2">{review.objectivelyVerified}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4">
        <h3 className="text-sm font-medium text-white">Duplicate candidates</h3>
        <p className="mt-1 text-xs text-slate-500">{data.distinctions.duplicateCandidates}</p>
        {data.duplicateCandidates.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No cross-review duplicate candidates.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {data.duplicateCandidates.map((candidate) => (
              <li key={`${candidate.findingId}:${candidate.matchedFindingId}`} className="text-sm text-slate-300">
                <span className="font-medium text-white">
                  {candidate.file}:{candidate.line}
                </span>{' '}
                matches an earlier {candidate.category} finding. {candidate.reason}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-white">Rule suggestions</h3>
          <Link className="text-xs text-indigo-300 hover:text-indigo-200" to={`/repository-rules/${repositoryId}`}>
            Manage review rules
          </Link>
        </div>
        {data.ruleSuggestions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            No rule suggestions. Feedback never creates or disables a rule on its own.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.ruleSuggestions.map((suggestion) => (
              <li key={suggestion.category} className="text-sm text-slate-300">
                {suggestion.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function DistributionChart({
  title,
  rows,
}: {
  title: string
  rows: FeedbackAnalytics['distributionByCategory']
}): JSX.Element {
  return (
    <section className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4">
      <h3 className="text-sm font-medium text-white">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">No findings to chart.</p>
      ) : (
        <>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="key" stroke="#94a3b8" fontSize={12} />
                <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={12} />
                <Tooltip />
                <Legend />
                <Bar dataKey="truePositive" name="True positive" stackId="feedback" fill="#34d399" />
                <Bar dataKey="falsePositive" name="False positive" stackId="feedback" fill="#fbbf24" />
                <Bar dataKey="alreadyFixed" name="Already fixed" stackId="feedback" fill="#38bdf8" />
                <Bar dataKey="needsReview" name="Needs review" stackId="feedback" fill="#a78bfa" />
                <Bar dataKey="unassessed" name="Unassessed" stackId="feedback" fill="#64748b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="mt-3 w-full text-left text-xs text-slate-400">
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th className="py-1 pr-3 font-medium text-slate-300">{row.key}</th>
                  <td>
                    {row.total} findings, {row.unassessed} unassessed
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

export default FeedbackAnalyticsPage
