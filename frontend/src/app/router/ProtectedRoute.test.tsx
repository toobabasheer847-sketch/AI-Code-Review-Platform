// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppStore } from '@/app/store/useAppStore'

import { ProtectedRoute } from './ProtectedRoute'


vi.mock('@/features/auth/hooks/useAuth', () => ({
  useMe: () => ({ isLoading: false, error: undefined }),
}))

describe('ProtectedRoute', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    useAppStore.getState().reset()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('requires an authenticated user and admits one after session bootstrap', async () => {
    const renderRoute = (): void => {
      root.render(
        <MemoryRouter initialEntries={['/private']}>
          <Routes>
            <Route
              path="/private"
              element={<ProtectedRoute><div>private content</div></ProtectedRoute>}
            />
            <Route path="/login" element={<div>login page</div>} />
          </Routes>
        </MemoryRouter>
      )
    }

    await act(async () => renderRoute())
    expect(container.textContent).toContain('login page')

    await act(async () => {
      useAppStore.getState().setUser({
        id: 'user-1',
        email: 'person@example.com',
        fullName: 'Test Person',
        avatar: null,
        isVerified: true,
        createdAt: new Date().toISOString(),
      })
      root.unmount()
      root = createRoot(container)
      renderRoute()
    })
    expect(container.textContent).toContain('private content')
  })
})
