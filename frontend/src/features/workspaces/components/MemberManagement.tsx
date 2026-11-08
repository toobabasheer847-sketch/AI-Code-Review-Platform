import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { isValidEmail } from '@/lib/utils'

import { getWorkspaceErrorMessage, workspaceApi } from '../api/workspaceApi'
import type { InvitableWorkspaceRole, WorkspaceInvitation, WorkspaceMember, WorkspaceSummary } from '../domain/types'
import {
  assignableMemberRoles,
  canInviteMembers,
  canReactivateMember,
  canRemoveMember,
  canSuspendMember,
  canUpdateMember,
  invitationIsExpired,
  invitableRoles,
  workspaceRoleLabels,
  workspaceStatusLabels,
} from '../domain/workspace-access'

import { ConfirmDialog } from './ConfirmDialog'

const fieldClass =
  'w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-400'

interface MemberManagementProps {
  workspace: WorkspaceSummary
  actorUserId: string
}

export function MemberManagement({ workspace, actorUserId }: MemberManagementProps): JSX.Element {
  const queryClient = useQueryClient()
  const members = useQuery({
    queryKey: ['workspace-members', workspace.id],
    queryFn: () => workspaceApi.listMembers(workspace.id),
    retry: false,
  })
  const [pendingMember, setPendingMember] = useState<{
    action: 'suspend' | 'reactivate' | 'remove'
    member: WorkspaceMember
  } | null>(null)

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['workspace-members', workspace.id] })
  }

  const updateMember = useMutation({
    mutationFn: (input: { member: WorkspaceMember; role?: InvitableWorkspaceRole; status?: 'ACTIVE' | 'SUSPENDED' }) =>
      workspaceApi.updateMember(workspace.id, input.member.id, {
        ...(input.role ? { role: input.role } : {}),
        ...(input.status ? { status: input.status } : {}),
      }),
    onSuccess: async () => {
      toast.success('Member updated')
      setPendingMember(null)
      await refresh()
    },
    onError: (error) => toast.error(getWorkspaceErrorMessage(error, 'Unable to update this member')),
  })

  const removeMember = useMutation({
    mutationFn: (member: WorkspaceMember) => workspaceApi.removeMember(workspace.id, member.id),
    onSuccess: async () => {
      toast.success('Member removed')
      setPendingMember(null)
      await refresh()
    },
    onError: (error) => toast.error(getWorkspaceErrorMessage(error, 'Unable to remove this member')),
  })

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-6">
      <h2 className="text-base font-semibold text-white">Members</h2>
      <p className="mt-1 text-sm text-slate-400">
        Roles are Owner, Admin, Developer, and Viewer. Removed members can return only by accepting a new invitation.
      </p>
      {members.isPending ? (
        <div className="mt-4 space-y-3" role="status" aria-label="Loading members">
          <div className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />
          <div className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />
        </div>
      ) : members.isError ? (
        <div role="alert" className="mt-4 rounded-xl border border-rose-400/30 p-4 text-sm text-rose-200">
          <p>{getWorkspaceErrorMessage(members.error, 'Unable to load members')}</p>
          <button
            type="button"
            onClick={() => void members.refetch()}
            className="mt-3 rounded-lg border border-white/10 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Try again
          </button>
        </div>
      ) : members.data.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No members are listed for this workspace.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {members.data.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              actorRole={workspace.role}
              actorUserId={actorUserId}
              pending={updateMember.isPending || removeMember.isPending}
              onRole={(role) => updateMember.mutate({ member, role })}
              onSuspend={() => setPendingMember({ action: 'suspend', member })}
              onReactivate={() => setPendingMember({ action: 'reactivate', member })}
              onRemove={() => setPendingMember({ action: 'remove', member })}
            />
          ))}
        </ul>
      )}
      {pendingMember && (
        <ConfirmDialog
          title={confirmTitle(pendingMember.action, pendingMember.member)}
          description={confirmDescription(pendingMember.action)}
          confirmLabel={confirmLabel(pendingMember.action)}
          pending={updateMember.isPending || removeMember.isPending}
          onCancel={() => setPendingMember(null)}
          onConfirm={() => {
            if (pendingMember.action === 'remove') removeMember.mutate(pendingMember.member)
            else if (pendingMember.action === 'suspend') {
              updateMember.mutate({ member: pendingMember.member, status: 'SUSPENDED' })
            } else updateMember.mutate({ member: pendingMember.member, status: 'ACTIVE' })
          }}
        />
      )}
    </section>
  )
}

function MemberRow({
  member,
  actorRole,
  actorUserId,
  pending,
  onRole,
  onSuspend,
  onReactivate,
  onRemove,
}: {
  member: WorkspaceMember
  actorRole: WorkspaceSummary['role']
  actorUserId: string
  pending: boolean
  onRole: (role: InvitableWorkspaceRole) => void
  onSuspend: () => void
  onReactivate: () => void
  onRemove: () => void
}): JSX.Element {
  const name = member.user.fullName || member.user.email
  const access = { actorRole, actorUserId, memberUserId: member.userId, memberRole: member.role, memberStatus: member.status }
  const roles = assignableMemberRoles(actorRole)
  const [role, setRole] = useState<InvitableWorkspaceRole>(
    member.role === 'OWNER' ? 'DEVELOPER' : member.role
  )
  useEffect(() => {
    if (member.role !== 'OWNER') setRole(member.role)
  }, [member.role])
  const editable = canUpdateMember(access) && actorUserId.length > 0

  return (
    <li className="rounded-xl border border-white/[0.06] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{name}</p>
          <p className="truncate text-xs text-slate-500">{member.user.email}</p>
          <p className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-white/[0.06] px-2 py-1 text-slate-300">
              {workspaceRoleLabels[member.role]}
            </span>
            <span className="rounded-full bg-white/[0.06] px-2 py-1 text-slate-300">
              {workspaceStatusLabels[member.status]}
            </span>
          </p>
        </div>
        {actorUserId && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {editable && (
              <>
                <label className="sr-only" htmlFor={`role-${member.id}`}>
                  Role for {name}
                </label>
                <select
                  id={`role-${member.id}`}
                  aria-label={`Role for ${name}`}
                  value={role}
                  onChange={(event) => setRole(event.target.value as InvitableWorkspaceRole)}
                  className="rounded-lg border border-white/10 bg-[#10141e] px-2 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  {roles.map((option) => (
                    <option key={option} value={option}>
                      {workspaceRoleLabels[option]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={pending || role === member.role}
                  onClick={() => onRole(role)}
                  className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
                >
                  Save role for {name}
                </button>
              </>
            )}
            {canSuspendMember(access) && (
              <button
                type="button"
                onClick={onSuspend}
                disabled={pending}
                className="rounded-lg border border-amber-300/30 px-3 py-2 text-sm text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50"
              >
                Suspend {name}
              </button>
            )}
            {canReactivateMember(access) && (
              <button
                type="button"
                onClick={onReactivate}
                disabled={pending}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
              >
                Reactivate {name}
              </button>
            )}
            {canRemoveMember(access) && (
              <button
                type="button"
                onClick={onRemove}
                disabled={pending}
                className="rounded-lg border border-rose-400/30 px-3 py-2 text-sm text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50"
              >
                Remove {name}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function confirmTitle(action: 'suspend' | 'reactivate' | 'remove', member: WorkspaceMember): string {
  const name = member.user.fullName || member.user.email
  if (action === 'suspend') return `Suspend ${name}?`
  if (action === 'reactivate') return `Reactivate ${name}?`
  return `Remove ${name}?`
}

function confirmDescription(action: 'suspend' | 'reactivate' | 'remove'): string {
  if (action === 'suspend') return 'They keep their membership and lose access until an owner or admin reactivates them.'
  if (action === 'reactivate') return 'They regain access with their current role.'
  return 'They lose access. A removed member can return only by accepting a new invitation.'
}

function confirmLabel(action: 'suspend' | 'reactivate' | 'remove'): string {
  if (action === 'suspend') return 'Suspend member'
  if (action === 'reactivate') return 'Reactivate member'
  return 'Remove member'
}

interface InvitationManagementProps {
  workspace: WorkspaceSummary
}

export function InvitationManagement({ workspace }: InvitationManagementProps): JSX.Element {
  const queryClient = useQueryClient()
  const canInvite = canInviteMembers(workspace.role, workspace.isPersonal)
  const roles = invitableRoles(workspace.role)
  const invitations = useQuery({
    queryKey: ['workspace-invitations', workspace.id],
    queryFn: () => workspaceApi.listInvitations(workspace.id),
    enabled: canInvite,
    retry: false,
  })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitableWorkspaceRole>(
    roles.includes('DEVELOPER') ? 'DEVELOPER' : (roles[0] ?? 'DEVELOPER')
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [deliveryMessage, setDeliveryMessage] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<
    { type: 'revoke' | 'resend'; invitation: WorkspaceInvitation } | null
  >(null)

  const invite = useMutation({
    mutationFn: () => workspaceApi.invite(workspace.id, { email: email.trim(), role }),
    onSuccess: async (invitation) => {
      const message = `Invitation email sent to ${invitation.email}.`
      toast.success(message)
      setEmail('')
      setFormError(null)
      setDeliveryMessage(message)
      await queryClient.invalidateQueries({ queryKey: ['workspace-invitations', workspace.id] })
    },
    onError: (error) => {
      const message = getWorkspaceErrorMessage(error, 'The invitation email could not be sent.')
      setDeliveryMessage(null)
      setFormError(message)
      toast.error(message)
    },
  })

  const revoke = useMutation({
    mutationFn: (invitation: WorkspaceInvitation) => workspaceApi.revokeInvitation(workspace.id, invitation.id),
    onSuccess: async () => {
      toast.success('Invitation revoked')
      setPendingAction(null)
      await queryClient.invalidateQueries({ queryKey: ['workspace-invitations', workspace.id] })
    },
    onError: (error) => toast.error(getWorkspaceErrorMessage(error, 'Unable to revoke the invitation')),
  })

  const resend = useMutation({
    mutationFn: (invitation: WorkspaceInvitation) => workspaceApi.resendInvitation(workspace.id, invitation.id),
    onSuccess: async (invitation) => {
      const message = `Invitation email resent to ${invitation.email}.`
      toast.success(message)
      setFormError(null)
      setDeliveryMessage(message)
      setPendingAction(null)
      await queryClient.invalidateQueries({ queryKey: ['workspace-invitations', workspace.id] })
    },
    onError: (error) => {
      const message = getWorkspaceErrorMessage(error, 'The invitation email could not be resent.')
      setDeliveryMessage(null)
      setFormError(message)
      setPendingAction(null)
      toast.error(message)
    },
  })

  if (!canInvite) {
    return (
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-6">
        <h2 className="text-base font-semibold text-white">Invitations</h2>
        <p className="mt-2 text-sm text-slate-400">
          {workspace.isPersonal
            ? 'Personal workspaces cannot invite other members.'
            : `${workspaceRoleLabels[workspace.role]}s can view members. Owners and admins manage invitations.`}
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-6">
      <h2 className="text-base font-semibold text-white">Invitations</h2>
      <p className="mt-1 text-sm text-slate-400">
        Invitation emails are sent to the invited person. Links stay out of this page. Pending invitations remain listed until they are accepted, revoked, or expire.
      </p>
      <form
        aria-label="Invite member"
        className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem_auto] md:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          if (!isValidEmail(email.trim()) || email.trim().length > 254) {
            setFormError('Enter a valid email address')
            return
          }
          setFormError(null)
          invite.mutate()
        }}
      >
        <label className="block text-sm text-slate-300" htmlFor="invite-email">
          Email address
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={`${fieldClass} mt-1.5`}
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        <label className="block text-sm text-slate-300" htmlFor="invite-role">
          Invitation role
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as InvitableWorkspaceRole)}
            className={`${fieldClass} mt-1.5`}
          >
            {roles.map((option) => (
              <option key={option} value={option}>
                {workspaceRoleLabels[option]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={invite.isPending}
          className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50"
        >
          {invite.isPending ? 'Inviting...' : 'Invite member'}
        </button>
      </form>
      {deliveryMessage && (
        <p role="status" className="mt-3 text-sm text-emerald-300">
          {deliveryMessage}
        </p>
      )}
      {formError && (
        <p role="alert" className="mt-3 text-sm text-rose-300">
          {formError}
        </p>
      )}
      <h3 className="mt-6 text-sm font-semibold text-white">Pending invitations</h3>
      {invitations.isPending ? (
        <div className="mt-3 h-16 animate-pulse rounded-xl bg-white/[0.04]" role="status" aria-label="Loading invitations" />
      ) : invitations.isError ? (
        <div role="alert" className="mt-3 text-sm text-rose-200">
          <p>{getWorkspaceErrorMessage(invitations.error, 'Unable to load invitations')}</p>
          <button
            type="button"
            onClick={() => void invitations.refetch()}
            className="mt-3 rounded-lg border border-white/10 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Try again
          </button>
        </div>
      ) : invitations.data.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No pending invitations.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {invitations.data.map((invitation) => {
            const expired = invitationIsExpired(invitation.expiresAt)
            return (
              <li key={invitation.id} className="flex flex-col gap-3 rounded-xl border border-white/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-white">{invitation.email}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {workspaceRoleLabels[invitation.role]} · {expired ? 'Expired' : 'Pending'}
                    {Number.isFinite(Date.parse(invitation.expiresAt))
                      ? ` · ${new Date(invitation.expiresAt).toLocaleDateString()}`
                      : ''}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  {expired ? (
                    <p className="text-xs text-slate-500">
                      This invitation has expired. Revoke it before sending a new one.
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingAction({ type: 'resend', invitation })}
                      disabled={resend.isPending}
                      className="rounded-lg border border-indigo-400/30 px-3 py-2 text-sm text-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50"
                    >
                      {resend.isPending && resend.variables?.id === invitation.id
                        ? 'Resending...'
                        : `Resend invitation for ${invitation.email}`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingAction({ type: 'revoke', invitation })}
                    className="rounded-lg border border-rose-400/30 px-3 py-2 text-sm text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                  >
                    Revoke invitation for {invitation.email}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {pendingAction?.type === 'revoke' && (
        <ConfirmDialog
          title={`Revoke the invitation for ${pendingAction.invitation.email}?`}
          description="The invitation link stops working. This screen never shows the link itself."
          confirmLabel="Revoke invitation"
          pending={revoke.isPending}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => revoke.mutate(pendingAction.invitation)}
        />
      )}
      {pendingAction?.type === 'resend' && (
        <ConfirmDialog
          title={`Resend the invitation to ${pendingAction.invitation.email}?`}
          description="The previous invitation link stops working. A new email is sent with a new expiration. This screen never shows the link."
          confirmLabel="Resend invitation"
          pendingLabel="Resending..."
          tone="primary"
          pending={resend.isPending}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => resend.mutate(pendingAction.invitation)}
        />
      )}
    </section>
  )
}
