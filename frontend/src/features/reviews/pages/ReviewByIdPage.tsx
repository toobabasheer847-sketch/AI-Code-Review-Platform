import { useParams, Link } from 'react-router-dom'
import { useGetReview } from '../hooks/useReviews'
import { ReviewDetails } from '../components/ReviewDetails'

export const ReviewByIdPage = (): JSX.Element => {
  const { id } = useParams<{ id: string }>()
  const { data: review, isLoading, error } = useGetReview(id)

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100">
      <div className="container mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/reviews"
          className="text-sm text-indigo-400 transition hover:text-indigo-300"
        >
          &larr; Back to all reviews
        </Link>
        <h1 className="mb-6 mt-4 text-3xl font-bold text-white">Code Review</h1>

        {isLoading && <p className="text-sm text-slate-400">Loading review...</p>}
        {error && (
          <p className="text-sm text-red-300">
            {error instanceof Error ? error.message : 'Unable to load review'}
          </p>
        )}
        {review && <ReviewDetails review={review} />}
      </div>
    </div>
  )
}
