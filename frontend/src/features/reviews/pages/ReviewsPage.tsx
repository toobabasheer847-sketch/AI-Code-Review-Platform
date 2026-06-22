import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useListReviews, useGetReview } from '../hooks/useReviews'
import { StartReviewButton } from '../components/StartReviewButton'
import { ReviewDetails } from '../components/ReviewDetails'

export const ReviewsPage = (): JSX.Element => {
  const { search } = useLocation()
  const navigate = useNavigate()
  const q = useMemo(() => new URLSearchParams(search), [search])
  const repoParam = q.get('repo') || undefined

  const { data: reviews = [], isLoading } = useListReviews()

  const matched = repoParam
    ? reviews.find((r) => r.repository === decodeURIComponent(repoParam))
    : undefined
  const { data: reviewDetail, isLoading: loadingDetail } = useGetReview(matched?.id)

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
                        <div className="mt-1 text-sm text-slate-400">
                          {new Date(r.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-3xl font-bold ${scoreColor}`}>
                          {r.score ?? '—'}
                        </div>
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
      </div>
    </div>
  )
}
