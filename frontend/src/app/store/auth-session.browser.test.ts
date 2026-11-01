// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { CookieJar, JSDOM } from 'jsdom'

describe('browser session credential storage', () => {
  it('does not expose an HttpOnly authentication cookie to JavaScript', () => {
    const cookieJar = new CookieJar()
    const apiOrigin = 'http://localhost:3001'
    cookieJar.setCookieSync(
      'ai-codeguard-session=sensitive-session-value; HttpOnly; Path=/; SameSite=Lax',
      apiOrigin
    )
    const browser = new JSDOM('', { url: apiOrigin, cookieJar })

    expect(browser.window.document.cookie).not.toContain('ai-codeguard-session')
    expect(
      cookieJar.getCookiesSync(apiOrigin, { http: true }).some((cookie) =>
        cookie.key === 'ai-codeguard-session' && cookie.httpOnly
      )
    ).toBe(true)
    browser.window.close()
  })

  it('removes previously persisted JWT storage and the readable legacy cookie', async () => {
    window.localStorage.setItem('app-store', JSON.stringify({ state: { token: 'legacy-jwt' } }))
    window.localStorage.setItem('auth-store', JSON.stringify({ state: { token: 'legacy-jwt' } }))
    document.cookie = 'token=legacy-jwt; Path=/; SameSite=Strict'
    vi.resetModules()

    const { useAppStore } = await import('./useAppStore')

    expect(window.localStorage.getItem('app-store')).toBeNull()
    expect(window.localStorage.getItem('auth-store')).toBeNull()
    expect(document.cookie).not.toContain('token=legacy-jwt')
    expect(Object.keys(useAppStore.getState())).not.toContain('token')
    useAppStore.getState().setUser({
      id: 'user-1',
      email: 'person@example.com',
      fullName: 'Test Person',
      avatar: null,
      isVerified: true,
      createdAt: new Date().toISOString(),
    })
    expect(window.localStorage.getItem('app-store')).toBeNull()
  })

  it('clears in-memory authentication when another tab invalidates the session', async () => {
    const { useAppStore } = await import('./useAppStore')
    useAppStore.getState().setUser({
      id: 'user-1',
      email: 'person@example.com',
      fullName: 'Test Person',
      avatar: null,
      isVerified: true,
      createdAt: new Date().toISOString(),
    })

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'ai-codeguard-session-invalidated' })
    )

    expect(useAppStore.getState().isAuthenticated).toBe(false)
    expect(useAppStore.getState().user).toBeNull()
  })
})
