import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { ReviewDetails } from '../components/ReviewDetails'
import { StartReviewButton } from '../components/StartReviewButton'
import { useListReviews, useGetReview } from '../hooks/useReviews'

export const ReviewsPage = (): JSX.Element => {
  const { search } = useLocation()
  const navigate = useNavigate()
  const q = useMemo(() => new URLSearchParams(search), [search])
  const repoParam = q.get('repo') || undefined

  const reviewsQuery = useListReviews()
  const reviews = reviewsQuery.data ?? []
  const { isLoading } = reviewsQuery

  const matched = repoParam
    ? reviews.find((r) => r.repository === decodeURIComponent(repoParam))
    : undefined
  const reviewDetailQuery = useGetReview(matched?.id)
  const { data: reviewDetail, isLoading: loadingDetail } = reviewDetailQuery

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100">
      <div className="container mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="mb-6 text-3xl font-bold text-white">Code Reviews</h1>

        {repoParam && (
          <div className="mb-6">
            <button
              type="button"
              onClick={() => navigate('/github/repos')}
              className="text-sm text-indigo-400 transition hover:text-indigo-300"
            >
              &larr; Back to Repositories
            </button>
            <h2 className="mt-2 text-lg font-semibold text-white">
              {decodeURIComponent(repoParam)}
            </h2>
            <p className="mt-1 text-sm text-slate-400">Repository review details</p>
          </div>
        )}

        {(() => {
          if (isLoading) {
            return <p className="text-sm text-slate-400">Loading reviews...</p>
          }

          if (reviewsQuery.isError && reviews.length === 0) {
            return (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6" role="alert">
                <p className="text-sm text-red-200">Reviews could not be loaded.</p>
                <p className="mt-1 text-sm text-red-200/80">
                  {reviewsQuery.error instanceof Error
                    ? reviewsQuery.error.message
                    : 'Unable to load reviews.'}
                </p>
                <button
                  type="button"
                  onClick={() => void reviewsQuery.refetch()}
                  className="mt-3 rounded-lg border border-red-300/30 px-3 py-2 text-sm text-red-100 hover:bg-red-400/10"
                >
                  Try again
                </button>
              </div>
            )
          }

          if (repoParam) {
            if (!matched) {
              return (
                <div className="rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 backdrop-blur-md">
                  <p className="mb-4 text-sm text-slate-400">
                    No review found for this repository yet.
                  </p>
                  <p className="mb-4 text-sm text-slate-300">
                    Request an AI review of this repository (this will analyze your code and
                    return a scorecard).
                  </p>
                  <StartReviewButton repo={decodeURIComponent(repoParam)} />
                </div>
              )
            }

            if (reviewDetailQuery.isError) {
              return (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6" role="alert">
                  <p className="text-sm text-red-200">Review details could not be loaded.</p>
                  <p className="mt-1 text-sm text-red-200/80">
                    {reviewDetailQuery.error instanceof Error
                      ? reviewDetailQuery.error.message
                      : 'Unable to load this review.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void reviewDetailQuery.refetch()}
                    className="mt-3 rounded-lg border border-red-300/30 px-3 py-2 text-sm text-red-100 hover:bg-red-400/10"
                  >
                    Try again
                  </button>
                </div>
              )
            }

            if (loadingDetail || !reviewDetail) {
              return <p className="text-sm text-slate-400">Loading review...</p>
            }

            return <ReviewDetails review={reviewDetail} />
          }

          if (reviews.length === 0) {
            return (
              <div className="rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 backdrop-blur-md">
                <p className="text-sm text-slate-400">You have no reviews yet.</p>
                <button
                  type="button"
                  onClick={() => navigate('/github/repos')}
                  className="mt-4 text-sm text-indigo-400 transition hover:text-indigo-300"
                >
                  Select a repository to start &rarr;
                </button>
              </div>
            )
          }

          return (
            <div className="space-y-4">
              {reviews.map((r) => {
                const score = r.score ?? 0
                const scoreColor =
                  score >= 80
                    ? 'text-emerald-400'
                    : score >= 60
                      ? 'text-amber-400'
                      : 'text-violet-400'

                return (
                  <div
                    key={r.id}
                    className="rounded-xl border border-slate-800 bg-[#1e293b]/40 p-6 backdrop-blur-md transition hover:border-slate-700"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-lg font-semibold text-white">{r.repository}</div>
                        {r.source === 'PULL_REQUEST' && (
                          <div className="mt-1 text-xs text-indigo-300">
                            Pull request #{r.pullRequestNumber}
                          </div>
                        )}
                        <div className="mt-1 text-sm text-slate-400">
                          {new Date(r.createdAt).toLocaleString()}
                        </div>
                        <div className="mt-1 text-xs capitalize text-indigo-300">{r.status}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-3xl font-bold ${scoreColor}`}>
                          {r.status === 'completed' ? (r.score ?? '—') : '—'}
                        </div>
                        {r.status === 'completed' && r.score !== null && (
                          <div className="text-[10px] text-slate-500">Heuristic score</div>
                        )}
                        <div className="mt-1 text-sm text-slate-400">Issues: {r.issues}</div>
                      </div>
                    </div>
                    <div className="mt-6 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`/reviews?repo=${encodeURIComponent(r.repository)}`)
                        }
                        className="rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition-all hover:from-indigo-600 hover:to-blue-700"
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
        {reviewsQuery.isError && reviews.length > 0 && (
          <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100" role="alert">
            Could not refresh reviews. Showing previously loaded results.
          </p>
        )}
      </div>
    </div>
  )
}
