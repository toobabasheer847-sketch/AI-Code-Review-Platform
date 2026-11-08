import type { Page, Route } from '@playwright/test'

export const apiOrigin = 'http://127.0.0.1:3001/api'
export const apiCorsHeaders = {
  'access-control-allow-origin': 'http://127.0.0.1:3000',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type,x-csrf-token,x-workspace-id',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
}

export interface MockResponse {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

export type ApiMock = (input: {
  method: string
  path: string
  route: Route
}) => Promise<MockResponse | undefined>

export async function mockApi(page: Page, handler: ApiMock): Promise<void> {
  await page.route(`${apiOrigin}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.slice(new URL(apiOrigin).pathname.length)
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: apiCorsHeaders })
      return
    }

    if (path === '/auth/csrf' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        headers: apiCorsHeaders,
        json: { csrfToken: 'e2e-csrf-token', expiresInMs: 300_000 },
      })
      return
    }

    const response = await handler({
      method: request.method(),
      path,
      route,
    })
    const result =
      response ??
      (request.method() === 'GET'
        ? { status: 200, body: [] }
        : { status: 200, body: {} })
    await route.fulfill({
      status: result.status ?? 200,
      headers: { ...apiCorsHeaders, ...result.headers },
      json: result.body ?? {},
    })
  })
}
