import 'dotenv/config'

const nodeEnv = process.env.NODE_ENV || 'development'
const jwtSecret =
  process.env.JWT_SECRET ||
  (nodeEnv === 'production' ? '' : 'your-secret-key')
const githubTokenEncryptionKey =
  process.env.GITHUB_TOKEN_ENCRYPTION_KEY ||
  (nodeEnv === 'production' ? '' : 'local-development-github-token-encryption-key')

function isPlaceholderSecret(secret: string): boolean {
  const normalized = secret.toLowerCase()
  return (
    normalized.includes('change-in-production') ||
    normalized.includes('replace-with') ||
    normalized.includes('your-secret') ||
    normalized.includes('change-me')
  )
}

export const env = {
  NODE_ENV: nodeEnv,
  PORT: parseInt(process.env.PORT || '3001', 10),
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: jwtSecret,
  JWT_EXPIRY: process.env.JWT_EXPIRY || '7d',
  GITHUB_TOKEN_ENCRYPTION_KEY: githubTokenEncryptionKey,
  GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS: process.env.GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || '',
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || '',
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET || '',
  GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3001/api/auth/github/callback',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID || '',
  STRIPE_API_VERSION: process.env.STRIPE_API_VERSION || '2023-10-16',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  MAIL_HOST: process.env.MAIL_HOST || 'smtp.gmail.com',
  MAIL_PORT: parseInt(process.env.MAIL_PORT || '587', 10),
  MAIL_USER: process.env.MAIL_USER || '',
  MAIL_PASSWORD: process.env.MAIL_PASSWORD || '',
  MAIL_FROM: process.env.MAIL_FROM || 'noreply@ai-codeguard.com',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
}

if (env.NODE_ENV === 'production') {
  const configurationErrors: string[] = []

  if (env.JWT_SECRET.length < 32 || isPlaceholderSecret(env.JWT_SECRET)) {
    configurationErrors.push(
      'JWT_SECRET must be a unique, non-placeholder secret of at least 32 characters'
    )
  }

  if (
    env.GITHUB_TOKEN_ENCRYPTION_KEY.length < 32 ||
    env.GITHUB_TOKEN_ENCRYPTION_KEY === env.JWT_SECRET ||
    isPlaceholderSecret(env.GITHUB_TOKEN_ENCRYPTION_KEY)
  ) {
    configurationErrors.push(
      'GITHUB_TOKEN_ENCRYPTION_KEY must be an independent, non-placeholder secret of at least 32 characters'
    )
  }

  if (
    env.GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS &&
    (env.GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS.length < 32 ||
      isPlaceholderSecret(env.GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS))
  ) {
    configurationErrors.push(
      'GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS must be a non-placeholder secret of at least 32 characters'
    )
  }

  if (configurationErrors.length > 0) {
    throw new Error(`Invalid production security configuration: ${configurationErrors.join('; ')}`)
  }
}

export const isDevelopment = env.NODE_ENV === 'development'
export const isProduction = env.NODE_ENV === 'production'
