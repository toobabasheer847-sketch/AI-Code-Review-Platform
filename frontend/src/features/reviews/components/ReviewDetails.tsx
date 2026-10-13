import type { ReviewDetail } from '@/features/reviews/api/reviewApi'

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
                Quality Score
              </div>
            </div>
          )}
        </div>
      </div>

      {review.status === 'completed' && (
        <section className="rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 backdrop-blur-md">
          <h3 className="mb-6 text-xl font-semibold text-white">
            Issues ({review.findings.length})
          </h3>
          {review.findings.length === 0 ? (
            <p className="text-sm text-slate-400">No issues found. Great code!</p>
          ) : (
            <ul className="space-y-4 divide-y divide-slate-800/80">
              {review.findings.map((f, i) => (
                <li key={`${f.file}-${f.line}-${i}`} className="pt-4 first:pt-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-indigo-300">
                        {f.file}:{f.line}
                      </div>
                      <div className="mt-2 text-sm text-slate-300">{f.message}</div>
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
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
