import { useQuery } from '@tanstack/react-query'

import { getWorkspaceErrorMessage, workspaceApi } from '../api/workspaceApi'

const actionLabels: Record<string, string> = {
  'organization.created': 'Organization created',
  'workspace.created': 'Workspace created',
  'workspace.updated': 'Workspace updated',
  'invitation.created': 'Invitation created',
  'invitation.revoked': 'Invitation revoked',
  'invitation.accepted': 'Invitation accepted',
  'invitation.declined': 'Invitation declined',
  'membership.role_changed': 'Member role changed',
  'membership.status_changed': 'Member status changed',
  'membership.removed': 'Member removed',
  'organization.ownership_transferred': 'Ownership transferred',
  'review.started': 'AI review started',
  'billing.updated': 'Billing updated',
  'repository.connected': 'Repository connected',
}

export function OrganizationActivity({
  workspaceId,
  enabled,
}: {
  workspaceId: string
  enabled: boolean
}): JSX.Element | null {
  const activity = useQuery({
    queryKey: ['workspace-activity', workspaceId],
    queryFn: () => workspaceApi.listActivity(workspaceId),
    enabled,
    retry: false,
  })
  if (!enabled) return null

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-6">
      <h2 className="text-base font-semibold text-white">Organization activity</h2>
      <p className="mt-1 text-sm text-slate-400">
        Recent changes recorded for this organization. Sign-in events stay on the account and are not listed here.
      </p>
      {activity.isPending ? (
        <div className="mt-4 space-y-3" role="status" aria-label="Loading organization activity">
          <div className="h-12 animate-pulse rounded-xl bg-white/[0.04]" />
          <div className="h-12 animate-pulse rounded-xl bg-white/[0.04]" />
        </div>
      ) : activity.isError ? (
        <div role="alert" className="mt-4 rounded-xl border border-rose-400/30 p-4 text-sm text-rose-200">
          <p>{getWorkspaceErrorMessage(activity.error, 'Unable to load organization activity')}</p>
          <button
            type="button"
            onClick={() => void activity.refetch()}
            className="mt-3 rounded-lg border border-white/10 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Try again
          </button>
        </div>
      ) : activity.data.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No organization activity is recorded yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {activity.data.map((event) => (
            <li key={event.id} className="rounded-xl border border-white/[0.06] px-4 py-3">
              <p className="text-sm text-white">{actionLabels[event.action] ?? event.action}</p>
              <p className="mt-1 text-xs text-slate-500">
                {event.resourceType}
                {event.resourceId ? ` ${event.resourceId}` : ''}
                {' · '}
                {new Date(event.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
