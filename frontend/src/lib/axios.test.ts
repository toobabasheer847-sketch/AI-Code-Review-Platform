import { AxiosHeaders, type AxiosAdapter } from 'axios'
import { afterEach, describe, expect, it } from 'vitest'

import { axiosInstance } from './axios'

describe('cookie-authenticated Axios client', () => {
  const originalAdapter = axiosInstance.defaults.adapter

  afterEach(() => {
    axiosInstance.defaults.adapter = originalAdapter
  })

  it('sends credentials and a CSRF header without adding an Authorization token', async () => {
    const observedRequests: Array<{
      url?: string
      withCredentials?: boolean
      headers: AxiosHeaders
    }> = []
    const adapter: AxiosAdapter = async (config) => {
      observedRequests.push({
        url: config.url,
        withCredentials: config.withCredentials,
        headers: AxiosHeaders.from(config.headers),
      })
      const data = config.url === '/auth/csrf'
        ? { csrfToken: 'signed-csrf-test-token', expiresInMs: 120_000 }
        : { user: { id: 'user-1' } }
      return {
        data,
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config,
      }
    }
    axiosInstance.defaults.adapter = adapter

    await axiosInstance.post('/auth/login', { email: 'person@example.com', password: 'secret' })

    const loginRequest = observedRequests.find((request) => request.url === '/auth/login')
    expect(axiosInstance.defaults.withCredentials).toBe(true)
    expect(loginRequest?.withCredentials).toBe(true)
    expect(loginRequest?.headers.get('X-CSRF-Token')).toBe('signed-csrf-test-token')
    expect(loginRequest?.headers.get('Authorization')).toBeUndefined()
  })
})
