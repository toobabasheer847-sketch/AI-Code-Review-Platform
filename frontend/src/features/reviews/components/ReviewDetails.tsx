import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'

import {
  findingStatuses,
  reviewApi,
  type FindingStatus,
  type ReviewDetail,
} from '@/features/reviews/api/reviewApi'

const statusLabels: Record<FindingStatus, string> = {
  UNREVIEWED: 'Unreviewed',
  CONFIRMED: 'Confirmed',
  FALSE_POSITIVE: 'False positive',
  DUPLICATE: 'Duplicate',
  FIXED: 'Fixed (developer-marked)',
  WONT_FIX: "Won't fix",
}

const allowedNextStatuses: Record<FindingStatus, FindingStatus[]> = {
  UNREVIEWED: ['CONFIRMED', 'FALSE_POSITIVE', 'DUPLICATE', 'FIXED', 'WONT_FIX'],
  CONFIRMED: ['UNREVIEWED', 'FALSE_POSITIVE', 'DUPLICATE', 'FIXED', 'WONT_FIX'],
  FALSE_POSITIVE: ['UNREVIEWED', 'CONFIRMED'],
  DUPLICATE: ['UNREVIEWED', 'CONFIRMED'],
  FIXED: ['UNREVIEWED', 'CONFIRMED'],
  WONT_FIX: ['UNREVIEWED', 'CONFIRMED'],
}

function FindingLifecyclePanel({
  reviewId,
  finding,
}: {
  reviewId: string
  finding: ReviewDetail['findings'][number]
}): JSX.Element {
  const queryClient = useQueryClient()
  const [nextStatus, setNextStatus] = useState<FindingStatus>(finding.status)
  const [reason, setReason] = useState('')
  const [patch, setPatch] = useState('')
  const updateStatus = useMutation({
    mutationFn: () =>
      reviewApi.updateFindingStatus(finding.id, {
        status: nextStatus,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: async () => {
      setReason('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reviews', reviewId] }),
        queryClient.invalidateQueries({ queryKey: ['reviews'] }),
      ])
    },
  })
  const createProposal = useMutation({
    mutationFn: () => reviewApi.createFixProposal(finding.id, patch),
    onSuccess: async () => {
      setPatch('')
      await queryClient.invalidateQueries({ queryKey: ['reviews', reviewId] })
    },
  })

  useEffect(() => setNextStatus(finding.status), [finding.status])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (nextStatus !== finding.status) updateStatus.mutate()
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-700/70 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Developer status</span>
        <span className="rounded-full border border-indigo-400/20 bg-indigo-400/10 px-2.5 py-1 text-xs font-medium text-indigo-200">
          {statusLabels[finding.status]}
        </span>
        {finding.status === 'FIXED' && (
          <span className="text-xs text-slate-500">
            {finding.independentlyVerifiedAt
              ? `Independently verified ${new Date(finding.independentlyVerifiedAt).toLocaleString()}`
              : 'Not independently verified'}
          </span>
        )}
      </div>

      <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
        <label className="sr-only" htmlFor={`finding-status-${finding.id}`}>
          Update finding status
        </label>
        <select
          id={`finding-status-${finding.id}`}
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value as FindingStatus)}
          disabled={updateStatus.isPending}
          className="min-h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
        >
          <option value={finding.status}>{statusLabels[finding.status]}</option>
          {allowedNextStatuses[finding.status].map((status) => (
            <option key={status} value={status}>
              {statusLabels[status]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`finding-reason-${finding.id}`}>
          Optional feedback reason
        </label>
        <input
          id={`finding-reason-${finding.id}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1_000}
          disabled={updateStatus.isPending}
          placeholder="Optional reason or developer feedback"
          className="min-h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={updateStatus.isPending || nextStatus === finding.status}
          className="min-h-10 rounded-lg bg-indigo-500/20 px-4 text-sm font-medium text-indigo-200 hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {updateStatus.isPending ? 'Saving…' : 'Save status'}
        </button>
      </form>

      {updateStatus.isError && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {updateStatus.error instanceof Error
            ? updateStatus.error.message
            : 'Finding status could not be saved.'}
        </p>
      )}

      <div className="mt-4">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Feedback history
        </h5>
        {finding.feedback.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No developer feedback yet.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {finding.feedback.map((entry) => (
              <li
                key={entry.id}
                className="border-l border-slate-700 pl-3 text-xs text-slate-400"
              >
                <p>
                  <span className="text-slate-200">{entry.user.fullName}</span>
                  {' · '}
                  {statusLabels[entry.previousStatus]} → {statusLabels[entry.status]}
                  {' · '}
                  {new Date(entry.createdAt).toLocaleString()}
                </p>
                {entry.reason && <p className="mt-1 whitespace-pre-wrap">{entry.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-5 border-t border-slate-800 pt-4">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Reviewable fix proposals
        </h5>
        <p className="mt-1 text-xs text-amber-200">
          Saving a proposal never applies it. This deployment does not execute proposals.
        </p>
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (patch.trim()) createProposal.mutate()
          }}
        >
          <label className="sr-only" htmlFor={`finding-patch-${finding.id}`}>
            Unified diff patch proposal
          </label>
          <textarea
            id={`finding-patch-${finding.id}`}
            value={patch}
            onChange={(event) => setPatch(event.target.value)}
            maxLength={100_000}
            disabled={createProposal.isPending}
            placeholder="Paste a unified diff to propose a fix"
            rows={6}
            className="min-h-32 rounded-lg border border-slate-700 bg-slate-900 p-3 font-mono text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={createProposal.isPending || !patch.trim()}
            className="min-h-10 justify-self-start rounded-lg bg-indigo-500/20 px-4 text-sm font-medium text-indigo-200 hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createProposal.isPending ? 'Saving proposal…' : 'Save patch proposal'}
          </button>
        </form>
        {createProposal.isError && (
          <p role="alert" className="mt-2 text-sm text-red-300">
            {createProposal.error instanceof Error
              ? createProposal.error.message
              : 'Fix proposal could not be saved.'}
          </p>
        )}
        {finding.fixProposals.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">No fix proposals yet.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {finding.fixProposals.map((proposal) => (
              <li key={proposal.id} className="rounded-lg border border-slate-700 p-3">
                <p className="text-xs text-slate-400">
                  Proposed {new Date(proposal.createdAt).toLocaleString()} · SHA-256{' '}
                  <code>{proposal.patchSha256}</code>
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-indigo-300">View patch</summary>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-300">
                    {proposal.patch}
                  </pre>
                </details>
                {proposal.attempts.map((attempt) => (
                  <div key={attempt.id} className="mt-3 border-t border-slate-800 pt-2 text-xs">
                    <p className="text-slate-300">
                      Proposal verification (does not mean applied): {attempt.status} ·{' '}
                      {attempt.executionStatus}
                    </p>
                    <p className="mt-1 text-slate-500">
                      Started {new Date(attempt.startedAt).toLocaleString()}
                      {attempt.completedAt &&
                        ` · Finished ${new Date(attempt.completedAt).toLocaleString()}`}
                    </p>
                    {attempt.testCommands.length > 0 && (
                      <ol className="mt-1 list-decimal pl-5 text-slate-400">
                        {attempt.testCommands.map((command, index) => (
                          <li key={`${attempt.id}-command-${index}`}>
                            <code>{command}</code>
                          </li>
                        ))}
                      </ol>
                    )}
                    {attempt.sanitizedLogs && (
                      <pre className="mt-1 whitespace-pre-wrap text-slate-500">
                        {attempt.sanitizedLogs}
                      </pre>
                    )}
                  </div>
                ))}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

const getScoreStyles = (score: number): {
  text: string
  bg: string
  border: string
  glow: string
  ring: string
} => {
  if (score >= 80) {
    return {
      text: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      glow: 'shadow-[0_0_40px_rgba(52,211,153,0.25)]',
      ring: 'ring-emerald-500/20',
    }
  }
  if (score >= 60) {
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      glow: 'shadow-[0_0_40px_rgba(251,191,36,0.2)]',
      ring: 'ring-amber-500/20',
    }
  }
  return {
    text: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    glow: 'shadow-[0_0_40px_rgba(167,139,250,0.2)]',
    ring: 'ring-violet-500/20',
  }
}

export const ReviewDetails = ({ review }: { review: ReviewDetail }): JSX.Element => {
  const qualityScore = review.analytics?.qualityScore ?? 0
  const scoreStyles = getScoreStyles(qualityScore)
  const repoName = review.title ?? review.repository.name
  const isProcessing = review.status === 'pending' || review.status === 'running'

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 backdrop-blur-md">
        {isProcessing && (
          <p className="mb-6 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">
            Review {review.status === 'pending' ? 'queued' : 'in progress'} for branch {review.branch}.
            This page updates automatically.
          </p>
        )}
        {review.status === 'failed' && (
          <p className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            Review failed{review.errorMessage ? `: ${review.errorMessage}` : '.'}
          </p>
        )}
        <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold text-white">{repoName}</h2>
            <p className="mt-2 text-sm text-slate-400">{review.repository.name}</p>
            {review.source === 'PULL_REQUEST' && (
              <div className="mt-2 space-y-1 text-sm text-slate-300">
                <p>Pull request #{review.pullRequestNumber}</p>
                {review.pullRequestUrl?.startsWith('https://github.com/') && (
                  <a
                    href={review.pullRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-300 hover:text-indigo-200"
                  >
                    Open on GitHub
                  </a>
                )}
                {review.pullRequestStatus && (
                  <p className="text-xs capitalize text-slate-400">
                    GitHub comments: {review.pullRequestStatus.replace(/-/g, ' ')}
                  </p>
                )}
              </div>
            )}
            <p className="mt-1 text-sm text-slate-400">
              {new Date(review.createdAt).toLocaleString()}
            </p>
          </div>

          {review.analytics && review.status === 'completed' && (
            <div
              className={`flex h-36 w-36 flex-col items-center justify-center rounded-full border ${scoreStyles.border} ${scoreStyles.bg} ${scoreStyles.glow} ring-4 ${scoreStyles.ring}`}
            >
              <div className={`text-5xl font-bold ${scoreStyles.text}`}>{qualityScore}</div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                Heuristic review score
              </div>
              <p className="mt-1 max-w-28 text-center text-[9px] leading-3 text-slate-500">
                Based on reported findings; not a guarantee of overall code quality.
              </p>
            </div>
          )}
        </div>
      </div>

      {review.status === 'completed' && (
        <section className="rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 backdrop-blur-md">
          <div className="mb-6 rounded-lg border border-slate-700/70 bg-slate-950/30 p-4">
            <h3 className="font-semibold text-white">Finding lifecycle</h3>
            <p className="mt-1 text-xs text-slate-400">
              {review.findingLifecycleAnalytics.developerMarkedFixed} developer-marked fixed ·{' '}
              {review.findingLifecycleAnalytics.independentlyVerifiedFixed} independently verified
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {findingStatuses.map((status) => (
                <span
                  key={status}
                  className="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-400"
                >
                  {statusLabels[status]}: {review.findingLifecycleAnalytics.statusCounts[status]}
                </span>
              ))}
            </div>
          </div>
          {review.reviewLimitations && review.reviewLimitations.length > 0 && (
            <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
              <h4 className="font-semibold">Partial review</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {review.reviewLimitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          )}
          <h3 className="mb-6 text-xl font-semibold text-white">
            Issues ({review.findings.length})
          </h3>
          {review.findings.length === 0 ? (
            <p className="text-sm text-slate-400">
              No findings were validated for the supplied source. This does not guarantee the code
              is free of issues.
            </p>
          ) : (
            <ul className="space-y-4 divide-y divide-slate-800/80">
              {review.findings.map((f) => (
                <li key={f.id} className="pt-4 first:pt-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-indigo-300">
                        {f.file}:{f.line}
                        {f.endLine && f.endLine > f.line ? `-${f.endLine}` : ''}
                      </div>
                      {f.title && <h4 className="mt-1 font-semibold text-white">{f.title}</h4>}
                      {f.category && (
                        <div className="mt-1 text-xs uppercase tracking-wide text-slate-400">
                          {f.category}
                        </div>
                      )}
                      <div className="mt-2 text-sm text-slate-300">{f.message}</div>
                      {f.evidence && (
                        <pre className="mt-3 overflow-x-auto rounded bg-slate-950/60 p-3 text-xs text-slate-300">
                          <code>{f.evidence}</code>
                        </pre>
                      )}
                    </div>
                    <div
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        f.severity === 'error'
                          ? 'bg-red-500/10 text-red-300'
                          : f.severity === 'warning'
                            ? 'bg-amber-500/10 text-amber-300'
                            : 'bg-blue-500/10 text-blue-300'
                      }`}
                    >
                      {f.severity}
                    </div>
                  </div>
                  {f.suggestions && f.suggestions.length > 0 && (
                    <div className="mt-3 border-l border-indigo-500/30 pl-3 text-sm text-slate-400">
                      <span className="font-medium text-indigo-300">Suggestion: </span>
                      {f.suggestions.join('; ')}
                    </div>
                  )}
                  <FindingLifecyclePanel reviewId={review.id} finding={f} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
