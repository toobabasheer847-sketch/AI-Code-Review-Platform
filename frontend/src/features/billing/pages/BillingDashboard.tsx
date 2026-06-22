import { useBillingStatus, useUsage } from '../hooks/useBilling'

export const BillingDashboard = (): JSX.Element => {
  const { data: sub } = useBillingStatus()
  const { data: usage } = useUsage()

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-white mb-6">Billing</h1>

        <section className="rounded-3xl border border-slate-900 bg-slate-900/50 backdrop-blur-md p-8 shadow-xl shadow-black/20">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Current Plan</h2>
              <p className="mt-2 text-sm text-slate-400">{sub?.plan ?? 'FREE'}</p>
            </div>
            <span className="inline-flex rounded-full bg-indigo-500/15 px-4 py-2 text-sm font-medium text-indigo-200 ring-1 ring-indigo-500/20">
              Current plan
            </span>
          </div>

          <div className="mt-6 rounded-3xl border border-slate-900/80 bg-slate-950/80 p-6">
            <p className="text-sm text-slate-300">Usage this month: {usage?.reviewCount ?? 0}</p>
          </div>
        </section>
      </div>
    </div>
  )
}
