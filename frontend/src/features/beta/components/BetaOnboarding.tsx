import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { betaApi } from '../api/betaApi'
import { betaLimitations, visibleOnboardingSteps } from '../beta'

export function BetaOnboarding(): JSX.Element {
  const queryClient = useQueryClient()
  const guide = useQuery({ queryKey: ['beta-guide'], queryFn: () => betaApi.guide(), retry: false })
  const dismiss = useMutation({
    mutationFn: () => betaApi.dismissOnboarding(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['beta-guide'] })
    },
  })
  const limitations = guide.data?.limitations ?? [...betaLimitations]
  const steps = visibleOnboardingSteps(guide.data?.steps ?? [], guide.data?.dismissed === true)

  return (
    <section className="mb-6 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-4" aria-labelledby="beta-limits">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="beta-limits" className="text-sm font-semibold text-amber-100">
            Controlled beta
          </h3>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-100/80">
            {limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <Link
          to="/feedback"
          className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-white/[0.04]"
        >
          Send feedback
        </Link>
      </div>
      {steps.length > 0 && (
        <ol className="mt-4 space-y-2">
          {steps.map((step) => (
            <li key={step.id} className="flex items-center justify-between gap-3 text-xs text-slate-300">
              <Link to={step.href} className="hover:text-white">
                {step.complete ? 'Done: ' : 'Next: '}
                {step.label}
              </Link>
              <span className="text-slate-500">{step.complete ? 'Complete' : 'Open'}</span>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => dismiss.mutate()}
              disabled={dismiss.isPending}
              className="text-xs text-slate-400 underline-offset-2 hover:underline"
            >
              Dismiss checklist
            </button>
          </li>
        </ol>
      )}
    </section>
  )
}
