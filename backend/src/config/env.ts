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
    normalized.includes('change-me') ||
    normalized.includes('generate-') ||
    normalized.includes('placeholder') ||
    normalized.includes('your-')
  )
}

export const env = {
  NODE_ENV: nodeEnv,
  PORT: process.env.PORT ? Number(process.env.PORT) : 3001,
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: jwtSecret,
  JWT_EXPIRY: process.env.JWT_EXPIRY || '7d',
  GITHUB_TOKEN_ENCRYPTION_KEY: githubTokenEncryptionKey,
  GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS: process.env.GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_MODEL: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || '',
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || '',
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET || '',
  GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3001/api/auth/github/callback',
  LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID || '',
  LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET || '',
  LINKEDIN_CALLBACK_URL:
    process.env.LINKEDIN_CALLBACK_URL || 'http://localhost:3001/api/social/linkedin/callback',
  LINKEDIN_API_VERSION: process.env.LINKEDIN_API_VERSION || '202609',
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

export function hasUsableOpenAIKey(apiKey = env.OPENAI_API_KEY): boolean {
  return apiKey.trim().length >= 20 && !isPlaceholderSecret(apiKey)
}

export function validateEnvironment(configuration: typeof env): void {
  const configurationErrors: string[] = []
  const isLocalAddress = (value: string): boolean => {
    try {
      const hostname = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '')
      return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
    } catch {
      return false
    }
  }

  if (!Number.isSafeInteger(configuration.PORT) || configuration.PORT < 1 || configuration.PORT > 65535) {
    configurationErrors.push('PORT must be an integer between 1 and 65535')
  }

  if (configuration.NODE_ENV !== 'production') {
    if (configurationErrors.length > 0) {
      throw new Error(`Invalid environment configuration: ${configurationErrors.join('; ')}`)
    }
    return
  }

  const stripeSettings = [
    configuration.STRIPE_SECRET_KEY,
    configuration.STRIPE_WEBHOOK_SECRET,
    configuration.STRIPE_PRO_PRICE_ID,
  ]
  if (stripeSettings.some(Boolean) && stripeSettings.some((value) => !value)) {
    configurationErrors.push(
      'STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and STRIPE_PRO_PRICE_ID must be configured together'
    )
  }

  if (!configuration.DATABASE_URL || !/^postgres(?:ql)?:\/\//i.test(configuration.DATABASE_URL)) {
    configurationErrors.push('DATABASE_URL must be a PostgreSQL connection URL')
  } else if (isLocalAddress(configuration.DATABASE_URL)) {
    configurationErrors.push('DATABASE_URL must not point to a local host in production')
  }
  if (!configuration.REDIS_URL || !/^rediss:\/\//i.test(configuration.REDIS_URL)) {
    configurationErrors.push('REDIS_URL must use a TLS-protected rediss:// connection URL')
  } else if (isLocalAddress(configuration.REDIS_URL)) {
    configurationErrors.push('REDIS_URL must not point to a local host in production')
  }
  let frontendUrl: URL | null = null
  try {
    frontendUrl = new URL(configuration.FRONTEND_URL)
  } catch {
    frontendUrl = null
  }
  if (
    !frontendUrl ||
    frontendUrl.protocol !== 'https:' ||
    Boolean(frontendUrl.username || frontendUrl.password) ||
    frontendUrl.pathname !== '/' ||
    frontendUrl.search !== '' ||
    frontendUrl.hash !== '' ||
    isLocalAddress(configuration.FRONTEND_URL)
  ) {
    configurationErrors.push('FRONTEND_URL must be a public HTTPS origin in production')
  }
  let githubCallbackUrl: URL | null = null
  try {
    githubCallbackUrl = new URL(configuration.GITHUB_CALLBACK_URL)
  } catch {
    githubCallbackUrl = null
  }
  if (
    !githubCallbackUrl ||
    githubCallbackUrl.protocol !== 'https:' ||
    Boolean(githubCallbackUrl.username || githubCallbackUrl.password) ||
    isLocalAddress(configuration.GITHUB_CALLBACK_URL)
  ) {
    configurationErrors.push('GITHUB_CALLBACK_URL must be a public HTTPS URL in production')
  }
  if (!configuration.OPENAI_API_KEY) configurationErrors.push('OPENAI_API_KEY is required')
  if (!configuration.GITHUB_CLIENT_ID) configurationErrors.push('GITHUB_CLIENT_ID is required')
  if (!configuration.GITHUB_CLIENT_SECRET) configurationErrors.push('GITHUB_CLIENT_SECRET is required')
  if (!configuration.GITHUB_WEBHOOK_SECRET) configurationErrors.push('GITHUB_WEBHOOK_SECRET is required')
  if (!configuration.STRIPE_SECRET_KEY) configurationErrors.push('STRIPE_SECRET_KEY is required')
  if (!configuration.STRIPE_WEBHOOK_SECRET) configurationErrors.push('STRIPE_WEBHOOK_SECRET is required')
  if (!configuration.STRIPE_PRO_PRICE_ID) configurationErrors.push('STRIPE_PRO_PRICE_ID is required')
  for (const [name, value] of [
    ['OPENAI_API_KEY', configuration.OPENAI_API_KEY],
    ['GITHUB_CLIENT_ID', configuration.GITHUB_CLIENT_ID],
    ['GITHUB_CLIENT_SECRET', configuration.GITHUB_CLIENT_SECRET],
    ['GITHUB_WEBHOOK_SECRET', configuration.GITHUB_WEBHOOK_SECRET],
    ['LINKEDIN_CLIENT_SECRET', configuration.LINKEDIN_CLIENT_SECRET],
    ['STRIPE_SECRET_KEY', configuration.STRIPE_SECRET_KEY],
    ['STRIPE_WEBHOOK_SECRET', configuration.STRIPE_WEBHOOK_SECRET],
    ['STRIPE_PRO_PRICE_ID', configuration.STRIPE_PRO_PRICE_ID],
  ] as const) {
    if (value && isPlaceholderSecret(value)) {
      configurationErrors.push(`${name} must not use a sample placeholder`)
    }
  }

  if (configuration.JWT_SECRET.length < 32 || isPlaceholderSecret(configuration.JWT_SECRET)) {
    configurationErrors.push('JWT_SECRET must be a unique, non-placeholder secret of at least 32 characters')
  }

  if (
    configuration.GITHUB_TOKEN_ENCRYPTION_KEY.length < 32 ||
    configuration.GITHUB_TOKEN_ENCRYPTION_KEY === configuration.JWT_SECRET ||
    isPlaceholderSecret(configuration.GITHUB_TOKEN_ENCRYPTION_KEY)
  ) {
    configurationErrors.push('GITHUB_TOKEN_ENCRYPTION_KEY must be an independent, non-placeholder secret of at least 32 characters')
  }

  if (
    configuration.GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS &&
    (configuration.GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS.length < 32 ||
      isPlaceholderSecret(configuration.GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS))
  ) {
    configurationErrors.push('GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS must be a non-placeholder secret of at least 32 characters')
  }

  if (configuration.STRIPE_SECRET_KEY && !/^sk_(test|live)_/.test(configuration.STRIPE_SECRET_KEY)) {
    configurationErrors.push('STRIPE_SECRET_KEY must be a Stripe test or live secret key')
  }
  if (configuration.STRIPE_WEBHOOK_SECRET && !configuration.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
    configurationErrors.push('STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret')
  }
  if (configuration.STRIPE_PRO_PRICE_ID && !configuration.STRIPE_PRO_PRICE_ID.startsWith('price_')) {
    configurationErrors.push('STRIPE_PRO_PRICE_ID must be a Stripe price ID')
  }
  if (Boolean(configuration.LINKEDIN_CLIENT_ID) !== Boolean(configuration.LINKEDIN_CLIENT_SECRET)) {
    configurationErrors.push('LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be configured together')
  }
  if (configuration.LINKEDIN_CLIENT_ID && configuration.LINKEDIN_CLIENT_SECRET) {
    let callbackUrl: URL | null = null
    try {
      callbackUrl = new URL(configuration.LINKEDIN_CALLBACK_URL)
    } catch {
      callbackUrl = null
    }
    if (
      !callbackUrl ||
      !/^https?:$/.test(callbackUrl.protocol) ||
      (configuration.NODE_ENV === 'production' &&
        (callbackUrl.protocol !== 'https:' || isLocalAddress(configuration.LINKEDIN_CALLBACK_URL)))
    ) {
      configurationErrors.push('LINKEDIN_CALLBACK_URL must be a valid public HTTPS URL in production')
    }
  }
  if (!/^\d{6}$/.test(configuration.LINKEDIN_API_VERSION)) {
    configurationErrors.push('LINKEDIN_API_VERSION must use the YYYYMM format')
  }

  if (configurationErrors.length > 0) {
    throw new Error(`Invalid ${configuration.NODE_ENV} configuration: ${configurationErrors.join('; ')}`)
  }
}

validateEnvironment(env)

export const isDevelopment = env.NODE_ENV === 'development'
export const isProduction = env.NODE_ENV === 'production'
