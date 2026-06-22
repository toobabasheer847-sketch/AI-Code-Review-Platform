import { env } from '@/config/env'

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'

export function getGitHubAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: env.GITHUB_CALLBACK_URL,
    scope: 'repo read:user',
    state,
    allow_signup: 'true',
  })

  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`
}

export function getAccessTokenExchangeBody(code: string): URLSearchParams {
  return new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    client_secret: env.GITHUB_CLIENT_SECRET,
    code,
    redirect_uri: env.GITHUB_CALLBACK_URL,
  })
}

export interface GitHubTokenResponse {
  access_token: string
  scope: string
  token_type: string
}

export interface GitHubUserProfile {
  id: number
  login: string
  node_id: string
  avatar_url: string
  url: string
  html_url: string
  name: string | null
  email: string | null
}
