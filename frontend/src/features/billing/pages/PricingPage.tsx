import { UpgradeButton } from '../components/UpgradeButton'

export const PricingPage = (): JSX.Element => {
  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100">
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Pricing</h1>
          <p className="mt-2 text-sm text-slate-400">Choose the plan that fits your workflow and level up your code review process.</p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <section className="rounded-3xl border border-slate-800 bg-[#1e293b]/50 backdrop-blur-md p-8 shadow-xl shadow-black/20">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Free</h2>
                <p className="mt-2 text-sm text-slate-400">3 AI reviews / month</p>
              </div>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">Starter</span>
            </div>

            <div className="mt-6 space-y-4 text-sm text-slate-300">
              <p>3 code reviews per month</p>
              <p>Basic security feedback</p>
              <p>Email support</p>
            </div>

            <button className="mt-6 w-full rounded-xl border border-slate-800 bg-[#0f172a]/90 px-5 py-3 text-sm font-medium text-slate-200 transition hover:bg-slate-800">
              Current plan
            </button>
          </section>

          <section className="rounded-3xl border border-indigo-500/30 bg-[#1e293b]/50 backdrop-blur-md p-8 shadow-2xl shadow-indigo-500/15">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Pro</h2>
                <p className="mt-2 text-sm text-slate-400">Unlimited reviews, priority support</p>
              </div>
              <span className="rounded-full bg-indigo-500/15 px-3 py-1 text-xs text-indigo-200">Best choice</span>
            </div>

            <div className="mt-6 space-y-4 text-sm text-slate-300">
              <p>Unlimited code reviews</p>
              <p>Advanced metrics and analytics</p>
              <p>Priority support and faster analysis</p>
            </div>

            <div className="mt-6">
              <UpgradeButton priceId={import.meta.env.VITE_STRIPE_PRO_PRICE_ID ?? ''}>Upgrade</UpgradeButton>
            </div>
            {!import.meta.env.VITE_STRIPE_PRO_PRICE_ID && (
              <p className="mt-4 text-sm text-rose-300">
                Stripe price ID not configured. Add <span className="font-semibold">VITE_STRIPE_PRO_PRICE_ID</span> to your frontend environment.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
