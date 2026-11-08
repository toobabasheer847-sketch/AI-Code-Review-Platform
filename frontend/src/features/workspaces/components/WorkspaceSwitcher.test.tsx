// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppStore } from '@/app/store/useAppStore'

import { workspaceApi } from '../api/workspaceApi'
import type { WorkspaceSummary } from '../domain/types'
import { getActiveWorkspaceId, setActiveWorkspaceId } from '../store/workspace-selection'

import { WorkspaceSwitcher } from './WorkspaceSwitcher'

vi.mock('../api/workspaceApi', async () => {
  const actual = await vi.importActual<typeof import('../api/workspaceApi')>('../api/workspaceApi')
  return {
    ...actual,
    workspaceApi: {
      list: vi.fn(),
      create: vi.fn(),
    },
  }
})

const personal: WorkspaceSummary = {
  id: 'ws-personal',
  organizationId: 'org-personal',
  name: 'Ada Personal',
  slug: 'ada-personal',
  isPersonal: true,
  role: 'OWNER',
  organization: { id: 'org-personal', name: 'Ada Personal', slug: 'ada-personal' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const team: WorkspaceSummary = {
  ...personal,
  id: 'ws-team',
  organizationId: 'org-team',
  name: 'Platform Team',
  slug: 'platform-team',
  isPersonal: false,
  organization: { id: 'org-team', name: 'Platform Org', slug: 'platform-org' },
}

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
        <WorkspaceSwitcher />
      </QueryClientProvider>
    )
  })
}

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
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

beforeEach(() => {
  setActiveWorkspaceId(null)
  vi.mocked(workspaceApi.list).mockReset()
  vi.mocked(workspaceApi.create).mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  setActiveWorkspaceId(null)
  useAppStore.getState().reset()
})

describe('workspace switcher', () => {
  it('shows a loading state, then the personal workspace and switches workspaces', async () => {
    let resolveList: (workspaces: WorkspaceSummary[]) => void = () => undefined
    vi.mocked(workspaceApi.list).mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve
      })
    )
    render()
    expect(document.querySelector('[aria-label="Loading workspaces"]')).not.toBeNull()

    resolveList([personal, team])
    await settle()
    expect(document.body.textContent).toContain('Ada Personal, Personal')

    await clickButton('Ada Personal')
    await clickButton('Platform Team')
    expect(getActiveWorkspaceId()).toBe('ws-team')
    expect(window.localStorage.getItem('ai-codeguard-active-workspace')).toBe('ws-team')
    expect(document.body.textContent).toContain('Platform Team, Owner')
  })

  it('shows an empty state and creates a workspace', async () => {
    vi.mocked(workspaceApi.list).mockResolvedValue([])
    vi.mocked(workspaceApi.create).mockResolvedValue(team)
    render()
    await settle()
    expect(document.body.textContent).toContain('No workspace')

    await clickButton('No workspace')
    await clickButton('Create workspace')
    const input = document.getElementById('new-workspace-name')
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing workspace name')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'Platform Team')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await clickButton('Create workspace')
    await settle()

    expect(workspaceApi.create).toHaveBeenCalledWith({ name: 'Platform Team' })
    expect(getActiveWorkspaceId()).toBe('ws-team')
    expect(document.body.textContent).toContain('Platform Team, Owner')
  })

  it('shows an error state that can be retried', async () => {
    vi.mocked(workspaceApi.list).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([personal])
    render()
    await settle()
    expect(document.body.textContent).toContain('Workspaces unavailable')
    await clickButton('Workspaces unavailable')
    await settle()
    expect(document.body.textContent).toContain('Ada Personal, Personal')
  })

  it('clears the selected workspace when the session ends', () => {
    setActiveWorkspaceId('ws-team')
    useAppStore.getState().logout()
    expect(getActiveWorkspaceId()).toBeNull()
    expect(window.localStorage.getItem('ai-codeguard-active-workspace')).toBeNull()
  })
})
