import { Octokit } from 'octokit'
import { env } from './env'

export const octokitClient = new Octokit({
  auth: env.GITHUB_CLIENT_SECRET,
})

export const githubOAuthConfig = {
  clientId: env.GITHUB_CLIENT_ID,
  clientSecret: env.GITHUB_CLIENT_SECRET,
  redirectUri: env.GITHUB_CALLBACK_URL,
}
