const STORAGE_KEY = 'ai-codeguard-active-workspace'
const INVITATION_TOKEN_KEY = 'ai-codeguard-invitation-token'
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // The in-memory selection still applies in this tab.
  }
}

function readSession(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSession(key: string, value: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (value) window.sessionStorage.setItem(key, value)
    else window.sessionStorage.removeItem(key)
  } catch {
    // The invitation can still be accepted from memory during this page view.
  }
}

function validWorkspaceId(value: string | null): string | null {
  return value && WORKSPACE_ID_PATTERN.test(value) ? value : null
}

let activeWorkspaceId = validWorkspaceId(readStorage(STORAGE_KEY))
const listeners = new Set<() => void>()

export function getActiveWorkspaceId(): string | null {
  return activeWorkspaceId
}

export function setActiveWorkspaceId(workspaceId: string | null): void {
  const next = validWorkspaceId(workspaceId)
  if (activeWorkspaceId === next) return
  activeWorkspaceId = next
  writeStorage(STORAGE_KEY, next)
  listeners.forEach((listener) => listener())
}

export function subscribeActiveWorkspace(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function stashInvitationToken(token: string): void {
  if (!INVITATION_TOKEN_PATTERN.test(token)) return
  writeSession(INVITATION_TOKEN_KEY, token)
}

export function readInvitationToken(): string | null {
  const token = readSession(INVITATION_TOKEN_KEY)
  return token && INVITATION_TOKEN_PATTERN.test(token) ? token : null
}

export function clearInvitationToken(): void {
  writeSession(INVITATION_TOKEN_KEY, null)
}

export function clearWorkspaceSession(): void {
  setActiveWorkspaceId(null)
  clearInvitationToken()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    const next = validWorkspaceId(event.newValue)
    if (activeWorkspaceId === next) return
    activeWorkspaceId = next
    listeners.forEach((listener) => listener())
  })
}
