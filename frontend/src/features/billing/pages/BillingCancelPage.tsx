import { XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

export const BillingCancelPage = (): JSX.Element => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a] px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 text-center backdrop-blur-md shadow-2xl shadow-black/20">
        <XCircle className="mx-auto h-12 w-12 text-amber-400" />
        <h1 className="mt-4 text-2xl font-bold text-white">Checkout cancelled</h1>
        <p className="mt-2 text-sm text-slate-400">
          No charges were made. You can upgrade to Pro anytime from the pricing page.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            to="/pricing"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 px-6 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition hover:from-indigo-600 hover:to-blue-700"
          >
            View Pricing
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-800 px-6 text-sm font-medium text-slate-200 transition hover:bg-slate-900"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
