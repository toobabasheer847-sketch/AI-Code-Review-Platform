import { AxiosError, type AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { axiosInstance } from '@/lib/axios'

import { getWorkspaceErrorMessage, workspaceApi } from './workspaceApi'

vi.mock('@/lib/axios', () => ({
  axiosInstance: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

describe('workspace API client', () => {
  beforeEach(() => {
    vi.mocked(axiosInstance.get).mockReset()
    vi.mocked(axiosInstance.post).mockReset()
  })

  it('accepts an empty list payload from unmatched clients', async () => {
    vi.mocked(axiosInstance.get).mockResolvedValue({ data: [] })
    await expect(workspaceApi.list()).resolves.toEqual([])
  })

  it('does not return invitation secrets from the create response', async () => {
    vi.mocked(axiosInstance.post).mockResolvedValue({
      data: {
        invitation: {
          id: 'inv-1',
          email: 'new@example.com',
          role: 'DEVELOPER',
          expiresAt: '2027-01-01T00:00:00.000Z',
          token: 'super-secret-invitation-token-value',
          acceptUrl: 'http://localhost/accept-invitation?token=super-secret-invitation-token-value',
        },
      },
    })

    const invitation = await workspaceApi.invite('ws-team', {
      email: 'new@example.com',
      role: 'DEVELOPER',
    })

    expect(invitation).toEqual({
      id: 'inv-1',
      email: 'new@example.com',
      role: 'DEVELOPER',
      expiresAt: '2027-01-01T00:00:00.000Z',
    })
    expect(JSON.stringify(invitation)).not.toContain('super-secret')
    expect(JSON.stringify(invitation)).not.toContain('acceptUrl')
  })

  it('does not return invitation secrets from a resend response', async () => {
    vi.mocked(axiosInstance.post).mockResolvedValue({
      data: {
        invitation: {
          id: 'inv-2',
          email: 'new@example.com',
          role: 'DEVELOPER',
          expiresAt: '2027-02-01T00:00:00.000Z',
          token: 'super-secret-invitation-token-value',
          acceptUrl: 'http://localhost/accept-invitation?token=super-secret-invitation-token-value',
        },
      },
    })

    const invitation = await workspaceApi.resendInvitation('ws-team', 'inv-1')

    expect(invitation).toEqual({
      id: 'inv-2',
      email: 'new@example.com',
      role: 'DEVELOPER',
      expiresAt: '2027-02-01T00:00:00.000Z',
    })
    expect(JSON.stringify(invitation)).not.toContain('super-secret')
    expect(JSON.stringify(invitation)).not.toContain('acceptUrl')
    expect(axiosInstance.post).toHaveBeenCalledWith('/workspaces/ws-team/invitations/inv-1/resend')
  })

  it('returns safe API messages and hides invitation secrets', () => {
    const response = (error: string): AxiosError =>
      new AxiosError('request failed', '400', undefined, undefined, {
        status: 400,
        data: { error },
        statusText: 'Bad Request',
        headers: {},
        config: { headers: {} },
      } as AxiosResponse)
    expect(getWorkspaceErrorMessage(response('A workspace with this name already exists'), 'fallback')).toBe(
      'A workspace with this name already exists'
    )
    expect(
      getWorkspaceErrorMessage(response('Invalid invitation token super-secret-invitation-token-value'), 'fallback')
    ).toBe('fallback')
  })
})
