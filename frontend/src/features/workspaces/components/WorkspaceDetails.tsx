import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { getWorkspaceErrorMessage, workspaceApi } from '../api/workspaceApi'
import type { WorkspaceMember, WorkspaceSummary } from '../domain/types'
import {
  canRenameWorkspace,
  canTransferWorkspaceOwnership,
  workspaceNameError,
  workspaceRoleLabels,
} from '../domain/workspace-access'

import { ConfirmDialog } from './ConfirmDialog'

const fieldClass =
  'w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-400'

interface WorkspaceDetailsProps {
  workspace: WorkspaceSummary
  members: WorkspaceMember[]
  actorUserId: string
}

export function WorkspaceDetails({ workspace, members, actorUserId }: WorkspaceDetailsProps): JSX.Element {
  const queryClient = useQueryClient()
  const canRename = canRenameWorkspace(workspace.role, workspace.isPersonal)
  const canTransfer = canTransferWorkspaceOwnership(workspace.role, workspace.isPersonal)
  const [name, setName] = useState(workspace.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const [newOwnerId, setNewOwnerId] = useState('')
  const [confirmTransfer, setConfirmTransfer] = useState(false)
  const candidates = members.filter(
    (member) => member.status === 'ACTIVE' && member.userId !== actorUserId && member.role !== 'OWNER'
  )
  const selectedCandidate = candidates.find((member) => member.userId === newOwnerId) ?? null

  const rename = useMutation({
    mutationFn: () => workspaceApi.update(workspace.id, name.trim()),
    onSuccess: async (updated) => {
      toast.success('Workspace name updated')
      queryClient.setQueryData<WorkspaceSummary[]>(['workspaces'], (current) =>
        current?.map((item) => (item.id === updated.id ? { ...item, ...updated, role: workspace.role } : item))
      )
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
    onError: (error) => {
      toast.error(getWorkspaceErrorMessage(error, 'Unable to update the workspace'))
    },
  })

  const transfer = useMutation({
    mutationFn: () => workspaceApi.transferOwnership(workspace.id, newOwnerId),
    onSuccess: async () => {
      toast.success('Ownership transferred')
      setConfirmTransfer(false)
      setNewOwnerId('')
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      await queryClient.invalidateQueries({ queryKey: ['workspace-members', workspace.id] })
    },
    onError: (error) => {
      toast.error(getWorkspaceErrorMessage(error, 'Unable to transfer ownership'))
    },
  })

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-6">
      <h2 className="text-base font-semibold text-white">Workspace details</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Organization</dt>
          <dd className="text-slate-200">{workspace.organization.name}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Address</dt>
          <dd className="text-slate-200">{workspace.slug}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Your role</dt>
          <dd className="text-slate-200">{workspaceRoleLabels[workspace.role]}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Type</dt>
          <dd className="text-slate-200">{workspace.isPersonal ? 'Personal' : 'Shared'}</dd>
        </div>
      </dl>

      {canRename ? (
        <form
          aria-label="Workspace details"
          className="mt-5 max-w-lg space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            const validationError = workspaceNameError(name)
            setNameError(validationError)
            if (!validationError) rename.mutate()
          }}
        >
          <label className="block text-sm text-slate-300" htmlFor="workspace-name">
            Workspace name
            <input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={`${fieldClass} mt-1.5`}
              maxLength={80}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'workspace-name-error' : undefined}
            />
          </label>
          {nameError && (
            <p id="workspace-name-error" role="alert" className="text-sm text-rose-300">
              {nameError}
            </p>
          )}
          <button
            type="submit"
            disabled={rename.isPending || name.trim() === workspace.name}
            className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50"
          >
            {rename.isPending ? 'Saving...' : 'Save workspace'}
          </button>
        </form>
      ) : (
        <p className="mt-5 text-sm text-slate-400">
          {workspace.isPersonal
            ? 'Personal workspaces cannot be renamed.'
            : 'Owners and admins can rename this workspace.'}
        </p>
      )}

      {canTransfer && (
        <form
          aria-label="Transfer ownership"
          className="mt-6 max-w-lg space-y-3 border-t border-white/[0.06] pt-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (selectedCandidate) setConfirmTransfer(true)
          }}
        >
          <h3 className="text-sm font-semibold text-white">Transfer ownership</h3>
          <p className="text-sm text-slate-400">
            The new owner must already be an active member of every workspace in this organization. You become an admin.
          </p>
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-500">There is no other active member to receive ownership.</p>
          ) : (
            <>
              <label className="block text-sm text-slate-300" htmlFor="new-owner">
                New owner
                <select
                  id="new-owner"
                  value={newOwnerId}
                  onChange={(event) => setNewOwnerId(event.target.value)}
                  className={`${fieldClass} mt-1.5`}
                >
                  <option value="">Select a member</option>
                  {candidates.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.user.fullName || member.user.email}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={!selectedCandidate || transfer.isPending}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
              >
                Transfer ownership
              </button>
            </>
          )}
        </form>
      )}

      {confirmTransfer && selectedCandidate && (
        <ConfirmDialog
          title={`Make ${selectedCandidate.user.fullName || selectedCandidate.user.email} the owner?`}
          description={`Ownership of ${workspace.name} moves to this member. You become an admin.`}
          confirmLabel="Transfer ownership"
          pending={transfer.isPending}
          onCancel={() => setConfirmTransfer(false)}
          onConfirm={() => transfer.mutate()}
        />
      )}
    </section>
  )
}
