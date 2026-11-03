// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { repositoryApi, type RepositoryReviewRule } from '@/features/repositories/api/repositoryApi'

import { RepositoryRulesPage } from './RepositoryRulesPage.tsx'

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useMe: () => ({ data: { fullName: 'Ada Lovelace' } }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/features/repositories/api/repositoryApi', () => ({
  repositoryApi: {
    list: vi.fn(),
    listRules: vi.fn(),
    createRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
  },
  repositoryReviewRuleCategories: ['BUG', 'SECURITY', 'GENERAL'],
  repositoryReviewRuleSeverities: ['WARNING', 'UNSPECIFIED'],
}))

const repository = {
  id: 'repo-1',
  name: 'octo/example',
  url: 'https://github.com/octo/example',
  language: null,
  createdAt: '2026-10-01T00:00:00.000Z',
}

function rule(overrides: Partial<RepositoryReviewRule> = {}): RepositoryReviewRule {
  return {
    id: 'rule-1',
    repositoryId: 'repo-1',
    title: 'Validate handlers',
    description: 'Check request bodies.',
    enabled: false,
    category: 'BUG',
    severityPreference: 'WARNING',
    scope: 'HTTP handlers',
    filePatterns: ['src/api/**/*.ts'],
    instructions: 'Confirm required fields are validated.',
    precedence: 1,
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
    history: [
      {
        id: 'revision-1',
        action: 'CREATED',
        createdAt: '2026-10-21T00:00:00.000Z',
        snapshot: {
          title: 'Validate handlers',
          description: 'Check request bodies.',
          enabled: true,
          category: 'BUG',
          severityPreference: 'WARNING',
          scope: 'HTTP handlers',
          filePatterns: ['src/api/**/*.ts'],
          instructions: 'Confirm required fields are validated.',
          precedence: 1,
        },
      },
    ],
    ...overrides,
  }
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
        <MemoryRouter initialEntries={['/repository-rules/repo-1']}>
          <Routes>
            <Route path="/repository-rules/:repositoryId" element={<RepositoryRulesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
}

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })
  }
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('repository review rules page', () => {
  it('shows a loading state, then disabled rules and precedence', async () => {
    vi.mocked(repositoryApi.list).mockResolvedValue([repository])
    vi.mocked(repositoryApi.listRules).mockReturnValue(new Promise(() => undefined))
    render()
    await settle()
    expect(document.body.textContent).toContain('Loading review rules...')

    vi.mocked(repositoryApi.listRules).mockResolvedValue([
      rule(),
      rule({ id: 'rule-2', title: 'Later rule', enabled: true, precedence: 10 }),
    ])
    render()
    await settle()
    expect(document.body.textContent).toContain('Validate handlers')
    expect(document.body.textContent).toContain('Disabled')
    expect(document.body.textContent).toContain('Precedence: 1')
    expect(document.body.textContent).toContain('Later rule')
  })

  it('shows an empty state and an error state', async () => {
    vi.mocked(repositoryApi.list).mockResolvedValue([repository])
    vi.mocked(repositoryApi.listRules).mockResolvedValue([])
    render()
    await settle()
    expect(document.body.textContent).toContain('No review rules yet')

    vi.mocked(repositoryApi.listRules).mockRejectedValue({
      response: { data: { error: 'Repository not found' } },
    })
    render()
    await settle()
    expect(document.body.textContent).toContain('Repository not found')
    expect(document.body.textContent).toContain('Try again')
  })
})
