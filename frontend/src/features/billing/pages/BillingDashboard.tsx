import { useState } from 'react'
import { Link } from 'react-router-dom'

import { getBillingErrorMessage } from '../api/billingApi'
import { useBillingStatus, useCancelSubscription, useUsage } from '../hooks/useBilling'

export const BillingDashboard = (): JSX.Element => {
  const { data: sub, isLoading: subscriptionLoading, isError: subscriptionError } = useBillingStatus()
  const { data: usage, isLoading: usageLoading, isError: usageError } = useUsage()
  const cancelSubscription = useCancelSubscription()
  const [cancelError, setCancelError] = useState('')
  const [cancelMessage, setCancelMessage] = useState('')
  const periodEnd = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : null
  const hasProAccess = sub?.plan === 'PRO' &&
    (sub.status === 'ACTIVE'
      ? periodEnd === null || periodEnd > Date.now()
      : sub.status === 'CANCELED' && periodEnd !== null && periodEnd > Date.now())
  const canCancel = hasProAccess && sub?.status === 'ACTIVE'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-white mb-6">Billing</h1>

        <section className="rounded-3xl border border-slate-900 bg-slate-900/50 backdrop-blur-md p-8 shadow-xl shadow-black/20">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Current Plan</h2>
              <p className="mt-2 text-sm text-slate-400">
                {subscriptionLoading ? 'Loading…' : subscriptionError ? 'Unavailable' : hasProAccess ? 'PRO' : 'FREE'}
                {sub?.status === 'CANCELED' && hasProAccess ? ' (cancels at period end)' : ''}
                {sub?.plan === 'PRO' && !hasProAccess ? ' (expired)' : ''}
              </p>
            </div>
            <span className="inline-flex rounded-full bg-indigo-500/15 px-4 py-2 text-sm font-medium text-indigo-200 ring-1 ring-indigo-500/20">
              Current plan
            </span>
          </div>

          <div className="mt-6 rounded-3xl border border-slate-900/80 bg-slate-950/80 p-6">
            <p className="text-sm text-slate-300">
              Usage this month: {usageLoading ? 'Loading…' : usageError ? 'Unavailable' : usage?.reviewCount ?? 0}
            </p>
            {subscriptionError && <p role="alert" className="mt-3 text-sm text-rose-300">Unable to load subscription status.</p>}
            {usageError && <p role="alert" className="mt-3 text-sm text-rose-300">Unable to load usage.</p>}
            {cancelError && <p role="alert" className="mt-3 text-sm text-rose-300">{cancelError}</p>}
            {cancelMessage && <p role="status" className="mt-3 text-sm text-emerald-300">{cancelMessage}</p>}
            {sub?.currentPeriodEnd && (
              <p className="mt-3 text-sm text-slate-400">
                Current period ends {new Date(sub.currentPeriodEnd).toLocaleDateString()}.
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              {canCancel && (
                <button
                  type="button"
                  disabled={cancelSubscription.isPending}
                  onClick={() => {
                    setCancelError('')
                    setCancelMessage('')
                    cancelSubscription.mutate(undefined, {
                      onSuccess: (result) => setCancelMessage(
                        `Cancellation is scheduled for ${new Date(result.currentPeriodEnd).toLocaleDateString()}.`
                      ),
                      onError: (error) => setCancelError(
                        getBillingErrorMessage(error, 'Unable to cancel the subscription.')
                      ),
                    })
                  }}
                  className="rounded-xl border border-rose-500/40 px-4 py-2 text-sm text-rose-200 disabled:opacity-50"
                >
                  {cancelSubscription.isPending ? 'Scheduling cancellation…' : 'Cancel at period end'}
                </button>
              )}
              {!hasProAccess && (
                <Link to="/pricing" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white">
                  View plans
                </Link>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
