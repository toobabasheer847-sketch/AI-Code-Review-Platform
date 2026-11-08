import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import { getWorkspaceErrorMessage, workspaceApi } from '../api/workspaceApi'
import { organizationNameError, resolveActiveWorkspaceId, workspaceNameError, workspaceRoleLabels } from '../domain/workspace-access'
import type { WorkspaceSummary } from '../domain/types'
import { useActivateWorkspace, useWorkspaces } from '../hooks/useWorkspaces'
import { getActiveWorkspaceId, setActiveWorkspaceId, subscribeActiveWorkspace } from '../store/workspace-selection'

const fieldClass =
  'w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus-visible:ring-2 focus-visible:ring-indigo-400'

export function WorkspaceSwitcher(): JSX.Element {
  const queryClient = useQueryClient()
  const workspaces = useWorkspaces()
  const activateWorkspace = useActivateWorkspace()
  const storedId = useSyncExternalStore(subscribeActiveWorkspace, getActiveWorkspaceId, () => null)
  const resolvedId = resolveActiveWorkspaceId(workspaces.data ?? [], storedId)
  const selected = workspaces.data?.find((workspace) => workspace.id === resolvedId) ?? null
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!workspaces.data) return
    const previous = getActiveWorkspaceId()
    const next = resolveActiveWorkspaceId(workspaces.data, previous)
    if (next === previous) return
    setActiveWorkspaceId(next)
    if (previous) {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== 'me' && query.queryKey[0] !== 'workspaces',
      })
    }
  }, [queryClient, workspaces.data])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (workspaces.isPending) {
    return (
      <div
        className="h-9 w-36 animate-pulse rounded-lg bg-white/[0.06]"
        role="status"
        aria-label="Loading workspaces"
      />
    )
  }

  if (workspaces.isError) {
    return (
      <button
        type="button"
        onClick={() => void workspaces.refetch()}
        className="h-9 max-w-[14rem] truncate rounded-lg border border-rose-400/30 px-3 text-xs text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
      >
        Workspaces unavailable
      </button>
    )
  }

  const label = selected
    ? `${selected.name}, ${selected.isPersonal ? 'Personal' : workspaceRoleLabels[selected.role]}`
    : 'No workspace'

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
        className="flex h-9 max-w-[9.5rem] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-left text-xs text-slate-200 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 sm:max-w-[14rem]"
      >
        <span className="min-w-0 flex-1 truncate">
          <span className="sr-only">Current workspace </span>
          {label}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-[#10141e] p-1.5 shadow-2xl">
          <ul id={listId} role="listbox" aria-label="Workspaces" className="max-h-72 overflow-y-auto">
            {(workspaces.data ?? []).length === 0 ? (
              <li className="px-2.5 py-3 text-xs text-slate-500">No workspace yet.</li>
            ) : (
              workspaces.data?.map((workspace) => (
                <li key={workspace.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={workspace.id === selected?.id}
                    onClick={() => {
                      activateWorkspace(workspace.id)
                      setOpen(false)
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{workspace.name}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {workspace.isPersonal ? 'Personal workspace' : workspace.organization.name}
                        {' · '}
                        {workspaceRoleLabels[workspace.role]}
                      </span>
                    </span>
                    {workspace.id === selected?.id && (
                      <Check className="h-3.5 w-3.5 text-indigo-300" aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setCreating(true)
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-indigo-200 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Create workspace
          </button>
        </div>
      )}
      {creating && (
        <CreateWorkspaceDialog
          onClose={() => setCreating(false)}
          onCreated={(workspace) => {
            queryClient.setQueryData<WorkspaceSummary[]>(['workspaces'], (current) => {
              const next = current ?? []
              return next.some((item) => item.id === workspace.id) ? next : [...next, workspace]
            })
            activateWorkspace(workspace.id)
            setCreating(false)
            toast.success(`Workspace ${workspace.name} created`)
          }}
        />
      )}
    </div>
  )
}

function CreateWorkspaceDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (workspace: WorkspaceSummary) => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const submit = async (): Promise<void> => {
    const nameError = workspaceNameError(name)
    const organizationError = organizationNameError(organizationName)
    if (nameError || organizationError) {
      setError(nameError ?? organizationError)
      return
    }
    setPending(true)
    setError(null)
    try {
      const workspace = await workspaceApi.create({
        name: name.trim(),
        ...(organizationName.trim() ? { organizationName: organizationName.trim() } : {}),
      })
      onCreated(workspace)
    } catch (cause) {
      setError(getWorkspaceErrorMessage(cause, 'Unable to create the workspace'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-workspace-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#10141e] p-5 shadow-2xl outline-none"
      >
        <h2 id="create-workspace-title" className="text-base font-semibold text-white">
          Create workspace
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          You become the owner. A personal workspace stays available for your own work.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="block text-sm text-slate-300" htmlFor="new-workspace-name">
            Workspace name
            <input
              id="new-workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={`${fieldClass} mt-1.5`}
              maxLength={80}
              required
              autoComplete="organization"
            />
          </label>
          <label className="block text-sm text-slate-300" htmlFor="new-organization-name">
            Organization name
            <span className="ml-2 text-xs text-slate-500">Optional</span>
            <input
              id="new-organization-name"
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              className={`${fieldClass} mt-1.5`}
              maxLength={100}
              autoComplete="organization"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50"
            >
              {pending ? 'Creating...' : 'Create workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
