import { Link } from 'react-router-dom'
import { CheckCircle } from 'lucide-react'

export const BillingSuccessPage = (): JSX.Element => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a] px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 text-center backdrop-blur-md shadow-2xl shadow-black/20">
        <CheckCircle className="mx-auto h-12 w-12 text-emerald-400" />
        <h1 className="mt-4 text-2xl font-bold text-white">Payment successful</h1>
        <p className="mt-2 text-sm text-slate-400">
          Your Pro subscription is being activated. You can start using unlimited reviews shortly.
        </p>
        <Link
          to="/dashboard"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 px-6 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition hover:from-indigo-600 hover:to-blue-700"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  )
}
