import { useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useAppStore } from '@/app/store/useAppStore'
import { useMe } from '@/features/auth/hooks/useAuth'

import { getWorkspaceErrorMessage, workspaceApi } from '../api/workspaceApi'
import { workspaceRoleLabels } from '../domain/workspace-access'
import { useActivateWorkspace } from '../hooks/useWorkspaces'
import {
  clearInvitationToken,
  readInvitationToken,
  stashInvitationToken,
} from '../store/workspace-selection'

const invitationTokenPattern = /^[A-Za-z0-9_-]{32,128}$/

export function AcceptInvitationPage(): JSX.Element {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const me = useMe()
  const queryClient = useQueryClient()
  const isAuthenticated = useAppStore((state) => state.isAuthenticated)
  const activateWorkspace = useActivateWorkspace()
  const [token] = useState(() => {
    const fromQuery = searchParams.get('token')?.trim() ?? ''
    if (searchParams.has('token')) {
      if (invitationTokenPattern.test(fromQuery)) {
        stashInvitationToken(fromQuery)
        return fromQuery
      }
      clearInvitationToken()
      return ''
    }
    return readInvitationToken() ?? ''
  })
  const [urlReady, setUrlReady] = useState(() => !searchParams.has('token'))
  const [status, setStatus] = useState<'ready' | 'pending' | 'accepted' | 'expired' | 'unavailable' | 'error'>('ready')
  const [message, setMessage] = useState<string | null>(null)
  const [acceptedRole, setAcceptedRole] = useState<string | null>(null)

  useEffect(() => {
    if (!searchParams.has('token')) return
    navigate('/accept-invitation', { replace: true })
    setUrlReady(true)
  }, [navigate, searchParams])

  if (!urlReady || me.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080b12] text-slate-300">
        <p role="status">Checking your session...</p>
      </main>
    )
  }

  if (!isAuthenticated || !me.data) {
    return <Navigate to="/login?returnUrl=%2Faccept-invitation" replace />
  }

  const accept = async (): Promise<void> => {
    if (token.length < 32) {
      setStatus('unavailable')
      setMessage('This invitation link is missing or invalid.')
      return
    }
    setStatus('pending')
    try {
      const membership = await workspaceApi.acceptInvitation(token)
      clearInvitationToken()
      try {
        queryClient.setQueryData(['workspaces'], await workspaceApi.list())
      } catch {
        // The workspace page loads the updated list if this refresh fails.
      }
      activateWorkspace(membership.workspaceId)
      setAcceptedRole(workspaceRoleLabels[membership.role])
      setStatus('accepted')
      toast.success('Invitation accepted')
    } catch (error) {
      const httpStatus = isAxiosError(error) ? error.response?.status : undefined
      if (httpStatus === 400 || httpStatus === 403 || httpStatus === 404 || httpStatus === 409 || httpStatus === 410) {
        clearInvitationToken()
      }
      if (httpStatus === 410) {
        setStatus('expired')
        setMessage('This invitation has expired. Ask an owner or admin for a new one.')
      } else if (httpStatus === 404 || httpStatus === 400) {
        setStatus('unavailable')
        setMessage('This invitation was revoked, already used, or is no longer valid.')
      } else if (httpStatus === 403) {
        setStatus('error')
        setMessage(
          getWorkspaceErrorMessage(
            error,
            'Sign in with the invited email address on a verified account.'
          )
        )
      } else {
        setStatus('error')
        setMessage(getWorkspaceErrorMessage(error, 'Unable to accept this invitation.'))
      }
      toast.error('Unable to accept this invitation')
    }
  }

  const title =
    status === 'accepted'
      ? 'Invitation accepted'
      : status === 'expired'
        ? 'Invitation expired'
        : status === 'unavailable'
          ? 'Invitation unavailable'
          : 'Accept workspace invitation'

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080b12] px-4 py-10 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#10141e] p-6 shadow-2xl">
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        {status === 'accepted' ? (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              You joined this workspace{acceptedRole ? ` as ${acceptedRole}` : ''}.
            </p>
            <Link
              to="/workspaces"
              className="mt-5 inline-flex rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              Go to workspace
            </Link>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {message ??
                (token.length >= 32
                  ? 'Accept the invitation sent to your account email. The invitation link is kept out of this page.'
                  : 'This invitation link is missing or invalid.')}
            </p>
            {token.length >= 32 && status !== 'expired' && status !== 'unavailable' && (
              <button
                type="button"
                onClick={() => void accept()}
                disabled={status === 'pending'}
                className="mt-5 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50"
              >
                {status === 'pending' ? 'Accepting...' : 'Accept invitation'}
              </button>
            )}
            <Link
              to="/workspaces"
              className="mt-4 block text-sm text-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              Back to workspace
            </Link>
          </>
        )}
      </section>
    </main>
  )
}
