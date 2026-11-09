const PLACEHOLDER_PATTERN = /(replace-with|your-|placeholder|example|change-me|sk-invalid)/i

export class ProviderTestEnvironmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderTestEnvironmentError'
  }
}

export function integrationOptIn(flag: string): boolean {
  return process.env[flag] === '1'
}

export interface GitHubIntegrationTarget {
  token: string
  owner: string
  repo: string
}

export function readGitHubIntegrationTarget(): GitHubIntegrationTarget | undefined {
  if (!integrationOptIn('RUN_GITHUB_INTEGRATION_TEST')) return undefined
  const token = process.env.GITHUB_INTEGRATION_TOKEN?.trim() ?? ''
  const owner = process.env.GITHUB_INTEGRATION_OWNER?.trim() ?? ''
  const repo = process.env.GITHUB_INTEGRATION_REPO?.trim() ?? ''
  if (!token || !owner || !repo) return undefined
  if (token.length < 20 || PLACEHOLDER_PATTERN.test(token) || /\s/.test(token)) {
    throw new ProviderTestEnvironmentError(
      'GITHUB_INTEGRATION_TOKEN must be a dedicated test token. The token value was not recorded.'
    )
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new ProviderTestEnvironmentError(
      'GITHUB_INTEGRATION_OWNER and GITHUB_INTEGRATION_REPO must be a dedicated test repository name.'
    )
  }
  return { token, owner, repo }
}

export function readOpenAIIntegrationKey(): string | undefined {
  if (!integrationOptIn('RUN_OPENAI_INTEGRATION_TEST')) return undefined
  const key = process.env.OPENAI_INTEGRATION_API_KEY?.trim() ?? ''
  if (!key) return undefined
  if (key.length < 20 || PLACEHOLDER_PATTERN.test(key) || key.startsWith('sk-invalid')) {
    throw new ProviderTestEnvironmentError(
      'OPENAI_INTEGRATION_API_KEY must be a dedicated non-placeholder key. The key was not recorded.'
    )
  }
  return key
}

export interface StripeIntegrationTarget {
  secretKey: string
}

export function readStripeIntegrationTarget(): StripeIntegrationTarget | undefined {
  if (!integrationOptIn('RUN_STRIPE_INTEGRATION_TEST')) return undefined
  const secretKey = process.env.STRIPE_INTEGRATION_SECRET_KEY?.trim() ?? ''
  if (!secretKey) return undefined
  if (secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_')) {
    throw new ProviderTestEnvironmentError(
      'Refusing to run Stripe integration tests with a live secret key.'
    )
  }
  if (!secretKey.startsWith('sk_test_') || secretKey.length < 20) {
    throw new ProviderTestEnvironmentError(
      'Stripe integration tests accept only a test-mode secret key.'
    )
  }
  return { secretKey }
}

export interface SmtpIntegrationTarget {
  host: string
  port: number
  apiUrl: string
}

export function readSmtpIntegrationTarget(): SmtpIntegrationTarget | undefined {
  const host = process.env.SMTP_INTEGRATION_HOST?.trim() ?? ''
  const port = Number(process.env.SMTP_INTEGRATION_PORT ?? '')
  const apiUrl = process.env.SMTP_INTEGRATION_API_URL?.trim() ?? ''
  if (!host && !apiUrl) return undefined
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new ProviderTestEnvironmentError(
      'SMTP integration tests accept only a localhost Mailpit server.'
    )
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ProviderTestEnvironmentError('SMTP_INTEGRATION_PORT must be a local port.')
  }
  let parsed: URL
  try {
    parsed = new URL(apiUrl)
  } catch {
    throw new ProviderTestEnvironmentError('SMTP_INTEGRATION_API_URL must be a localhost Mailpit URL.')
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new ProviderTestEnvironmentError('SMTP_INTEGRATION_API_URL must point at localhost.')
  }
  return { host, port, apiUrl: parsed.toString().replace(/\/$/, '') }
}
