import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'

import { useMe } from '@/features/auth/hooks/useAuth'
import { AutomationShell } from '@/features/automation/components/AutomationShell'

import { betaApi, type ProductFeedback } from '../api/betaApi'

const usageLabels: Record<string, string> = {
  REGISTRATION: 'Registrations',
  WORKSPACE_CREATED: 'Workspaces created',
  REPOSITORY_CONNECTED: 'GitHub connections',
  REVIEW_STARTED: 'Reviews started',
  REVIEW_COMPLETED: 'Reviews completed',
  REPO_CHAT: 'Repository chats',
  FEEDBACK_SUBMITTED: 'Feedback submitted',
}

export function BetaAdminPage(): JSX.Element {
  const user = useMe()
  const queryClient = useQueryClient()
  const overview = useQuery({ queryKey: ['beta-admin'], queryFn: () => betaApi.overview(), retry: false })
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProductFeedback['status'] }) => betaApi.updateStatus(id, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['beta-admin'] })
    },
  })
  const denied = isAxiosError(overview.error) && overview.error.response?.status === 403

  return (
    <AutomationShell title="Beta admin" description="Access, feedback, and usage for this beta" userName={user.data?.fullName ?? 'Your account'} pendingApprovals={0}>
      {denied && <p role="alert">Beta administration is not available for this account.</p>}
      {overview.data && (
        <div className="space-y-8">
          <section aria-labelledby="beta-usage">
            <h2 id="beta-usage" className="text-sm font-semibold text-white">Usage</h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              {Object.entries(overview.data.usage).map(([name, count]) => (
                <div key={name} className="rounded-lg border border-white/[0.07] px-3 py-3">
                  <dt className="text-xs text-slate-500">{usageLabels[name] ?? name}</dt>
                  <dd className="mt-1 text-lg text-white">{count}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section aria-labelledby="beta-users">
            <h2 id="beta-users" className="text-sm font-semibold text-white">Beta users</h2>
            <ul className="mt-3 space-y-2">
              {overview.data.users.map((item) => (
                <li key={item.id} className="text-sm text-slate-300">
                  {item.fullName} · {item.email} · {item.betaStatus}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="beta-feedback">
            <h2 id="beta-feedback" className="text-sm font-semibold text-white">Feedback</h2>
            <ul className="mt-3 space-y-3">
              {overview.data.feedback.map((item) => (
                <li key={item.id} className="rounded-lg border border-white/[0.07] p-3">
                  <p className="text-sm text-slate-100">{item.subject}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.category} · {item.status}</p>
                  <label className="mt-2 block text-xs text-slate-400">
                    Status
                    <select
                      aria-label={`Status for ${item.subject}`}
                      value={item.status}
                      onChange={(event) => updateStatus.mutate({ id: item.id, status: event.target.value as ProductFeedback['status'] })}
                      className="mt-1 rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-sm text-white"
                    >
                      {(['OPEN', 'TRIAGED', 'PLANNED', 'CLOSED'] as const).map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </AutomationShell>
  )
}
