import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import { AutomationShell } from '@/features/automation/components/AutomationShell'
import { useMe } from '@/features/auth/hooks/useAuth'

import { getWorkspaceErrorMessage, workspaceApi } from '../api/workspaceApi'
import { InvitationManagement, MemberManagement } from '../components/MemberManagement'
import { WorkspaceDetails } from '../components/WorkspaceDetails'
import { resolveActiveWorkspaceId } from '../domain/workspace-access'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { getActiveWorkspaceId, subscribeActiveWorkspace } from '../store/workspace-selection'

export function WorkspaceSettingsPage(): JSX.Element {
  const me = useMe()
  const workspaces = useWorkspaces()
  const storedId = useSyncExternalStore(subscribeActiveWorkspace, getActiveWorkspaceId, () => null)
  const workspace =
    workspaces.data?.find((item) => item.id === resolveActiveWorkspaceId(workspaces.data, storedId)) ?? null
  const members = useQuery({
    queryKey: ['workspace-members', workspace?.id],
    queryFn: () => workspaceApi.listMembers(workspace?.id ?? ''),
    enabled: Boolean(workspace),
    retry: false,
  })
  const userName = me.data?.fullName || 'Account'

  return (
    <AutomationShell
      title="Workspace"
      description="Members, invitations, and workspace details"
      userName={userName}
      pendingApprovals={0}
    >
      {workspaces.isPending ? (
        <div className="space-y-3" role="status" aria-label="Loading workspace administration">
          <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />
          <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />
        </div>
      ) : workspaces.isError ? (
        <div role="alert" className="rounded-2xl border border-rose-400/30 p-5 text-sm text-rose-200">
          <p>{getWorkspaceErrorMessage(workspaces.error, 'Unable to load workspaces')}</p>
          <button
            type="button"
            onClick={() => void workspaces.refetch()}
            className="mt-3 rounded-lg border border-white/10 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Try again
          </button>
        </div>
      ) : !workspace ? (
        <section className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
          <h2 className="text-base font-semibold text-white">No workspace yet</h2>
          <p className="mt-2 text-sm text-slate-400">Create a workspace from the switcher in the header.</p>
        </section>
      ) : (
        <div className="space-y-6">
          <WorkspaceDetails
            key={workspace.id}
            workspace={workspace}
            members={members.data ?? []}
            actorUserId={me.data?.id ?? ''}
          />
          <MemberManagement workspace={workspace} actorUserId={me.data?.id ?? ''} />
          <InvitationManagement workspace={workspace} />
        </div>
      )}
    </AutomationShell>
  )
}
