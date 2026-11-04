import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, BarChart3 } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { aiUsageApi } from '@/features/analytics/api/aiUsageApi'
import { useMe } from '@/features/auth/hooks/useAuth'
import { AutomationShell } from '@/features/automation/components/AutomationShell'
import { DashboardMetricCard } from '@/features/automation/components/DashboardMetricCard'

function formatNumber(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat().format(value)
}

function formatCost(value: number | null): string {
  return value === null
    ? 'Unavailable'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(value)
}

function featureLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

export const AIUsageAnalyticsPage = (): JSX.Element => {
  const { data: user } = useMe()
  const [searchParams, setSearchParams] = useSearchParams()
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
  const requestedPage = Number(searchParams.get('page') ?? '1')
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const analytics = useQuery({
    queryKey: ['ai-usage', from, to, page],
    queryFn: () =>
      aiUsageApi.getAnalytics({
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        page,
        pageSize: 20,
      }),
  })
  const data = analytics.data

  const updateQuery = (nextPage: number, nextFrom = draftFrom, nextTo = draftTo): void => {
    const next = new URLSearchParams()
    if (nextFrom) next.set('from', nextFrom)
    if (nextTo) next.set('to', nextTo)
    if (nextPage > 1) next.set('page', String(nextPage))
    setSearchParams(next)
  }

  return (
    <AutomationShell
      title="AI usage"
      description="Request, token, model, and estimated-cost reporting for your account"
      userName={user?.fullName ?? 'Your account'}
      pendingApprovals={0}
    >
      <div className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
          Analytics / AI usage
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">AI usage analytics</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Usage is scoped to your account. Estimated cost is shown only when pricing rates are configured;
          unknown provider token counts remain unavailable.
        </p>
      </div>

      <form
        className="mb-5 grid gap-3 rounded-xl border border-white/[0.07] bg-[#0e121b] p-4 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          updateQuery(1)
        }}
      >
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

      {analytics.isLoading && <p className="text-sm text-slate-400" role="status">Loading AI usage...</p>}
      {analytics.isError && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4" role="alert">
          <p className="text-sm text-rose-100">AI usage analytics could not be loaded.</p>
          <button
            type="button"
            className="mt-3 rounded-lg border border-rose-300/30 px-3 py-2 text-sm text-rose-50"
            onClick={() => void analytics.refetch()}
          >
            Try again
          </button>
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <DashboardMetricCard label="Total requests" value={data.totals.requests} icon={BarChart3} tone="bg-indigo-400/10 text-indigo-300" />
            <DashboardMetricCard label="Input tokens" value={formatNumber(data.totals.inputTokens)} icon={BarChart3} tone="bg-sky-400/10 text-sky-300" />
            <DashboardMetricCard label="Output tokens" value={formatNumber(data.totals.outputTokens)} icon={BarChart3} tone="bg-violet-400/10 text-violet-300" />
            <DashboardMetricCard label="Estimated cost" value={formatCost(data.totals.estimatedCostUsd)} icon={BarChart3} tone="bg-emerald-400/10 text-emerald-300" />
            <DashboardMetricCard label="Failed requests" value={data.totals.failedRequests} icon={BarChart3} tone="bg-rose-400/10 text-rose-300" />
          </div>

          <section className="mt-5 rounded-xl border border-white/[0.07] bg-[#0e121b] p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-slate-200">Usage trends</h3>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trends}>
                  <CartesianGrid stroke="rgba(255,255,255,0.07)" />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#0b0e15', border: '1px solid #293142' }} />
                  <Line type="monotone" dataKey="requests" stroke="#818cf8" strokeWidth={2} />
                  <Line type="monotone" dataKey="failedRequests" stroke="#fb7185" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-slate-500">Requests per day (failed requests shown separately).</p>
          </section>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {[
              ['Usage by feature', data.byFeature],
              ['Usage by model', data.byModel],
            ].map(([title, groups]) => (
              <section key={title as string} className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-200">{title as string}</h3>
                <div className="space-y-2">
                  {(groups as typeof data.byFeature).length === 0 ? (
                    <p className="text-sm text-slate-500">No usage in this date range.</p>
                  ) : (groups as typeof data.byFeature).map((group) => (
                    <div key={group.name} className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2 text-sm">
                      <span className="truncate text-slate-300">{title === 'Usage by feature' ? featureLabel(group.name) : group.name}</span>
                      <span className="shrink-0 text-slate-500">{group.requests} requests · {formatCost(group.estimatedCostUsd)}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <section className="mt-5 overflow-hidden rounded-xl border border-white/[0.07] bg-[#0e121b]">
            <div className="border-b border-white/[0.07] p-4">
              <h3 className="text-sm font-semibold text-slate-200">Request history</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-xs">
                <thead className="bg-white/[0.025] text-slate-500">
                  <tr>{['Date', 'Feature', 'Model', 'Input / output', 'Cost', 'Duration', 'Status'].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {data.records.map((record) => (
                    <tr key={record.id} className="text-slate-300">
                      <td className="px-4 py-3">{new Date(record.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3">{featureLabel(record.feature)}</td>
                      <td className="px-4 py-3">{record.modelName}{record.modelVersion ? ` (${record.modelVersion})` : ''}</td>
                      <td className="px-4 py-3">{formatNumber(record.inputTokens)} / {formatNumber(record.outputTokens)}</td>
                      <td className="px-4 py-3">{formatCost(record.estimatedCostUsd)}</td>
                      <td className="px-4 py-3">{record.durationMs} ms</td>
                      <td className={`px-4 py-3 ${record.status === 'FAILED' ? 'text-rose-300' : 'text-emerald-300'}`}>
                        {record.status === 'FAILED' ? `Failed${record.errorCategory ? ` · ${record.errorCategory}` : ''}` : 'Succeeded'}
                      </td>
                    </tr>
                  ))}
                  {data.records.length === 0 && <tr><td className="px-4 py-6 text-center text-slate-500" colSpan={7}>No AI requests for this date range.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-white/[0.07] px-4 py-3 text-xs text-slate-500">
              <span>{data.pagination.total} requests · Page {data.pagination.page} of {Math.max(data.pagination.totalPages, 1)}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => updateQuery(page - 1, from, to)}
                  className="rounded border border-white/10 p-2 disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ArrowLeft className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => updateQuery(page + 1, from, to)}
                  className="rounded border border-white/10 p-2 disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </AutomationShell>
  )
}
