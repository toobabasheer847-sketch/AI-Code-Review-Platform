// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { workspaceApi } from '../api/workspaceApi'
import type { WorkspaceInvitation, WorkspaceMember, WorkspaceSummary } from '../domain/types'
import { setActiveWorkspaceId } from '../store/workspace-selection'

import { WorkspaceSettingsPage } from './WorkspaceSettingsPage'

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useMe: () => ({
    data: {
      id: 'user-owner',
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      isVerified: true,
    },
    isLoading: false,
  }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../api/workspaceApi', async () => {
  const actual = await vi.importActual<typeof import('../api/workspaceApi')>('../api/workspaceApi')
  return {
    ...actual,
    workspaceApi: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      listMembers: vi.fn(),
      listInvitations: vi.fn(),
      invite: vi.fn(),
      revokeInvitation: vi.fn(),
      updateMember: vi.fn(),
      removeMember: vi.fn(),
      transferOwnership: vi.fn(),
      acceptInvitation: vi.fn(),
    },
  }
})

function workspace(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: 'ws-team',
    organizationId: 'org-team',
    name: 'Platform Team',
    slug: 'platform-team',
    isPersonal: false,
    role: 'OWNER',
    organization: { id: 'org-team', name: 'Platform Org', slug: 'platform-org' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function member(overrides: Partial<WorkspaceMember> = {}): WorkspaceMember {
  return {
    id: 'member-developer',
    userId: 'user-developer',
    role: 'DEVELOPER',
    status: 'ACTIVE',
    joinedAt: '2026-02-01T00:00:00.000Z',
    user: { email: 'grace@example.com', fullName: 'Grace Hopper', avatar: null },
    ...overrides,
  }
}

const members: WorkspaceMember[] = [
  member({
    id: 'member-owner',
    userId: 'user-owner',
    role: 'OWNER',
    user: { email: 'ada@example.com', fullName: 'Ada Lovelace', avatar: null },
  }),
  member(),
  member({
    id: 'member-viewer',
    userId: 'user-viewer',
    role: 'VIEWER',
    status: 'SUSPENDED',
    user: { email: 'alan@example.com', fullName: 'Alan Turing', avatar: null },
  }),
  member({
    id: 'member-removed',
    userId: 'user-removed',
    role: 'DEVELOPER',
    status: 'REMOVED',
    user: { email: 'old@example.com', fullName: 'Removed Person', avatar: null },
  }),
]

const invitations: WorkspaceInvitation[] = [
  {
    id: 'inv-pending',
    email: 'new@example.com',
    role: 'DEVELOPER',
    invitedById: 'user-owner',
    expiresAt: '2027-01-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'inv-expired',
    email: 'late@example.com',
    role: 'VIEWER',
    invitedById: 'user-owner',
    expiresAt: '2020-01-01T00:00:00.000Z',
    createdAt: '2019-12-01T00:00:00.000Z',
  },
]

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(): void {
  act(() => root?.unmount())
  container?.remove()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workspaces']}>
          <WorkspaceSettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
}

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
}

async function clickButton(text: string): Promise<void> {
  const buttons = Array.from(document.querySelectorAll('button'))
  const button =
    buttons.find((element) => element.textContent?.trim() === text) ??
    buttons.find((element) => element.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${text}`)
  await act(async () => {
    button.click()
  })
}

async function choose(label: string, value: string): Promise<void> {
  const select = document.querySelector(`select[aria-label="${label}"]`)
  if (!(select instanceof HTMLSelectElement)) throw new Error(`Missing select ${label}`)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  setActiveWorkspaceId('ws-team')
  vi.mocked(workspaceApi.list).mockClear()
  vi.mocked(workspaceApi.listMembers).mockClear()
  vi.mocked(workspaceApi.listInvitations).mockClear()
  vi.mocked(workspaceApi.updateMember).mockClear()
  vi.mocked(workspaceApi.invite).mockClear()
  vi.mocked(workspaceApi.revokeInvitation).mockClear()
  vi.mocked(workspaceApi.list).mockResolvedValue([workspace()])
  vi.mocked(workspaceApi.listMembers).mockResolvedValue(members)
  vi.mocked(workspaceApi.listInvitations).mockResolvedValue(invitations)
  vi.mocked(workspaceApi.updateMember).mockResolvedValue()
  vi.mocked(workspaceApi.invite).mockResolvedValue({
    id: 'inv-created',
    email: 'join@example.com',
    role: 'DEVELOPER',
    expiresAt: '2027-02-01T00:00:00.000Z',
  })
  vi.mocked(workspaceApi.revokeInvitation).mockResolvedValue()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  setActiveWorkspaceId(null)
})

describe('workspace administration page', () => {
  it('lets an owner manage roles, suspension, invitations, and expiration', async () => {
    render()
    await settle()

    expect(document.body.textContent).toContain('Grace Hopper')
    expect(document.body.textContent).toContain('Developer')
    expect(document.body.textContent).toContain('Suspended')
    expect(document.body.textContent).toContain('Removed')
    expect(document.body.textContent).toContain('Pending')
    expect(document.body.textContent).toContain('Expired')
    expect(document.body.textContent).not.toContain('Save role for Ada Lovelace')
    expect(document.body.textContent).not.toContain('Remove Removed Person')

    await choose('Role for Grace Hopper', 'VIEWER')
    await clickButton('Save role for Grace Hopper')
    await settle()
    expect(workspaceApi.updateMember).toHaveBeenCalledWith('ws-team', 'member-developer', { role: 'VIEWER' })

    await clickButton('Suspend Grace Hopper')
    await clickButton('Suspend member')
    await settle()
    expect(workspaceApi.updateMember).toHaveBeenCalledWith('ws-team', 'member-developer', { status: 'SUSPENDED' })

    await clickButton('Reactivate Alan Turing')
    await clickButton('Reactivate member')
    await settle()
    expect(workspaceApi.updateMember).toHaveBeenCalledWith('ws-team', 'member-viewer', { status: 'ACTIVE' })

    const email = document.getElementById('invite-email')
    if (!(email instanceof HTMLInputElement)) throw new Error('Missing invite email')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(email, 'join@example.com')
      email.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = document.querySelector('form[aria-label="Invite member"]')
    if (!(form instanceof HTMLFormElement)) throw new Error('Missing invite form')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await settle()
    expect(workspaceApi.invite).toHaveBeenCalledWith('ws-team', {
      email: 'join@example.com',
      role: 'DEVELOPER',
    })
    expect(document.body.textContent).toContain('Invitation email sent to join@example.com.')
    expect(document.body.textContent).not.toContain('acceptUrl')

    await clickButton('Revoke invitation for late@example.com')
    await clickButton('Revoke invitation')
    await settle()
    expect(workspaceApi.revokeInvitation).toHaveBeenCalledWith('ws-team', 'inv-expired')
  })

  it('shows an invitation email failure without revealing a token', async () => {
    vi.mocked(workspaceApi.invite).mockRejectedValue(
      Object.assign(new Error('request failed'), {
        isAxiosError: true,
        response: {
          data: {
            error: 'The invitation email could not be sent. No invitation was left pending.',
          },
        },
      })
    )
    render()
    await settle()
    const email = document.getElementById('invite-email')
    if (!(email instanceof HTMLInputElement)) throw new Error('Missing invite email')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(email, 'join@example.com')
      email.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = document.querySelector('form[aria-label="Invite member"]')
    if (!(form instanceof HTMLFormElement)) throw new Error('Missing invite form')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await settle()
    expect(document.body.textContent).toContain(
      'The invitation email could not be sent. No invitation was left pending.'
    )
    expect(document.body.textContent).not.toContain('token')
  })

  it('hides administration actions from viewers', async () => {
    vi.mocked(workspaceApi.list).mockResolvedValue([workspace({ role: 'VIEWER' })])
    render()
    await settle()

    expect(document.body.textContent).toContain('Grace Hopper')
    expect(document.body.textContent).toContain('Viewers can view members')
    expect(document.body.textContent).not.toContain('Invite member')
    expect(document.body.textContent).not.toContain('Save role for Grace Hopper')
    expect(document.body.textContent).not.toContain('Suspend Grace Hopper')
    expect(document.body.textContent).not.toContain('Save workspace')
    expect(document.body.textContent).not.toContain('Transfer ownership')
    expect(workspaceApi.listInvitations).not.toHaveBeenCalled()
  })

  it('lets an admin manage developers without managing other admins or ownership', async () => {
    vi.mocked(workspaceApi.list).mockResolvedValue([workspace({ role: 'ADMIN' })])
    vi.mocked(workspaceApi.listMembers).mockResolvedValue([
      member({
        id: 'member-admin',
        userId: 'user-owner',
        role: 'ADMIN',
        user: { email: 'ada@example.com', fullName: 'Ada Lovelace', avatar: null },
      }),
      member({
        id: 'member-other-admin',
        userId: 'user-admin-2',
        role: 'ADMIN',
        user: { email: 'other@example.com', fullName: 'Other Admin', avatar: null },
      }),
      member(),
    ])
    render()
    await settle()

    expect(document.body.textContent).not.toContain('Save role for Other Admin')
    expect(document.body.textContent).not.toContain('Remove Other Admin')
    expect(document.body.textContent).not.toContain('Transfer ownership')
    expect(document.body.textContent).toContain('Save role for Grace Hopper')
    const select = document.querySelector('select[aria-label="Role for Grace Hopper"]')
    if (!(select instanceof HTMLSelectElement)) throw new Error('Missing role select')
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['DEVELOPER', 'VIEWER'])
  })

  it('keeps personal workspaces from being renamed or inviting members', async () => {
    vi.mocked(workspaceApi.list).mockResolvedValue([
      workspace({ id: 'ws-personal', isPersonal: true, name: 'Ada Personal' }),
    ])
    setActiveWorkspaceId('ws-personal')
    render()
    await settle()

    expect(document.body.textContent).toContain('Personal workspaces cannot be renamed.')
    expect(document.body.textContent).toContain('Personal workspaces cannot invite other members.')
    expect(document.body.textContent).not.toContain('Save workspace')
    expect(document.body.textContent).not.toContain('Invite member')
  })
})
