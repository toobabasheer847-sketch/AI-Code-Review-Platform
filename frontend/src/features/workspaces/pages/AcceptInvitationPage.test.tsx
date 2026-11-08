// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAppStore } from '@/app/store/useAppStore'

import { workspaceApi } from '../api/workspaceApi'
import { readInvitationToken } from '../store/workspace-selection'
import { AcceptInvitationPage } from './AcceptInvitationPage'

const secret = 'super-secret-invitation-token-value'
const user = {
  id: 'user-1',
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  avatar: null,
  isVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const auth = vi.hoisted(() => ({
  state: {
    data: null as {
      id: string
      email: string
      fullName: string
      avatar: null
      isVerified: boolean
      createdAt: string
    } | null,
    isLoading: false,
  },
}))

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useMe: () => auth.state,
}))

vi.mock('../api/workspaceApi', async () => {
  const actual = await vi.importActual<typeof import('../api/workspaceApi')>('../api/workspaceApi')
  return {
    ...actual,
    workspaceApi: {
      ...actual.workspaceApi,
      list: vi.fn(),
      acceptInvitation: vi.fn(),
    },
  }
})

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(path: string): ReturnType<typeof createMemoryRouter> {
  act(() => root?.unmount())
  container?.remove()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/accept-invitation', element: <AcceptInvitationPage /> },
      { path: '/login', element: <p>Login page</p> },
      { path: '/workspaces', element: <p>Workspace page</p> },
    ],
    { initialEntries: [path] }
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
  })
  return router
}

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
}

function httpError(status: number): AxiosError {
  return new AxiosError('request failed', String(status), undefined, undefined, {
    status,
    data: { error: 'Invitation failed', token: secret },
    statusText: 'Error',
    headers: {},
    config: { headers: {} },
  } as AxiosResponse)
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  auth.state = { data: null, isLoading: false }
  useAppStore.getState().reset()
  window.sessionStorage.clear()
})

describe('accept invitation flow', () => {
  it('asks unauthenticated visitors to sign in without rendering the invitation secret', async () => {
    const router = render(`/accept-invitation?token=${secret}`)
    await settle()
    expect(document.body.textContent).toContain('Login page')
    expect(document.body.textContent).not.toContain(secret)
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).not.toContain('token')
    expect(readInvitationToken()).toBe(secret)
  })

  it('accepts an invitation and removes the secret from the page', async () => {
    auth.state = { data: user, isLoading: false }
    useAppStore.getState().setUser(user)
    vi.mocked(workspaceApi.acceptInvitation).mockResolvedValue({
      workspaceId: 'ws-team',
      role: 'DEVELOPER',
    })
    vi.mocked(workspaceApi.list).mockResolvedValue([])
    const router = render(`/accept-invitation?token=${secret}`)
    await settle()

    expect(router.state.location.search).toBe('')
    expect(document.body.textContent).toContain('Accept invitation')
    expect(document.body.textContent).not.toContain(secret)

    const button = Array.from(document.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Accept invitation')
    )
    if (!(button instanceof HTMLButtonElement)) throw new Error('Missing accept button')
    await act(async () => {
      button.click()
    })
    await settle()

    expect(workspaceApi.acceptInvitation).toHaveBeenCalledWith(secret)
    expect(document.body.textContent).toContain('Invitation accepted')
    expect(document.body.textContent).toContain('Developer')
    expect(document.body.textContent).not.toContain(secret)
    expect(readInvitationToken()).toBeNull()
  })

  it('shows expired and unavailable invitation states', async () => {
    auth.state = { data: user, isLoading: false }
    useAppStore.getState().setUser(user)
    vi.mocked(workspaceApi.acceptInvitation).mockRejectedValueOnce(httpError(410))
    render(`/accept-invitation?token=${secret}`)
    await settle()
    const accept = Array.from(document.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Accept invitation')
    )
    if (!(accept instanceof HTMLButtonElement)) throw new Error('Missing accept button')
    await act(async () => {
      accept.click()
    })
    await settle()
    expect(document.body.textContent).toContain('Invitation expired')
    expect(document.body.textContent).not.toContain(secret)

    vi.mocked(workspaceApi.acceptInvitation).mockRejectedValueOnce(httpError(404))
    render(`/accept-invitation?token=${secret}`)
    await settle()
    const retry = Array.from(document.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Accept invitation')
    )
    if (!(retry instanceof HTMLButtonElement)) throw new Error('Missing accept button')
    await act(async () => {
      retry.click()
    })
    await settle()
    expect(document.body.textContent).toContain('Invitation unavailable')
    expect(document.body.textContent).toContain('revoked')
    expect(document.body.textContent).not.toContain(secret)
  })

  it('shows an invalid state when the link has no usable token', async () => {
    auth.state = { data: user, isLoading: false }
    useAppStore.getState().setUser(user)
    render('/accept-invitation')
    await settle()
    expect(document.body.textContent).toContain('missing or invalid')
    expect(document.body.textContent).not.toContain('Accept invitation')
  })
})
