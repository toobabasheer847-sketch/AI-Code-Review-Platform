import assert from 'node:assert/strict'
import test from 'node:test'

const previousNodeEnv = process.env.NODE_ENV
process.env.NODE_ENV = 'test'
const { env, hasUsableOpenAIKey, validateEnvironment } = await import('./env')
if (previousNodeEnv === undefined) {
  delete process.env.NODE_ENV
} else {
  process.env.NODE_ENV = previousNodeEnv
}

function productionConfiguration(): typeof env {
  return {
    ...env,
    NODE_ENV: 'production',
    PORT: 3001,
    DATABASE_URL: 'postgresql://app:password@db.example.test:5432/app',
    JWT_SECRET: 'j'.repeat(48),
    GITHUB_TOKEN_ENCRYPTION_KEY: 'k'.repeat(48),
    GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS: '',
    OPENAI_API_KEY: 'openai-test-key',
    GITHUB_CLIENT_ID: 'github-client-id',
    GITHUB_CLIENT_SECRET: 'github-client-secret',
    GITHUB_WEBHOOK_SECRET: 'github-webhook-secret',
    GITHUB_CALLBACK_URL: 'https://api.example.test/api/auth/github/callback',
    STRIPE_SECRET_KEY: 'sk_test_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_example',
    STRIPE_PRO_PRICE_ID: 'price_example',
    REDIS_URL: 'rediss://redis.example.test:6380',
    FRONTEND_URL: 'https://app.example.test',
  }
}

test('accepts production configuration with HTTPS origins and TLS Redis', () => {
  assert.doesNotThrow(() => validateEnvironment(productionConfiguration()))
})

test('rejects placeholder and short OpenAI credentials for live review execution', () => {
  assert.equal(hasUsableOpenAIKey('sk-your-openai-api-key'), false)
  assert.equal(hasUsableOpenAIKey('short-test-key'), false)
  assert.equal(hasUsableOpenAIKey(`sk-${'x'.repeat(40)}`), true)
})

test('rejects insecure Redis and non-HTTPS production origins', () => {
  const insecureRedis = productionConfiguration()
  insecureRedis.REDIS_URL = 'redis://redis.example.test:6379'
  assert.throws(() => validateEnvironment(insecureRedis), /TLS-protected rediss/)

  const insecureFrontend = productionConfiguration()
  insecureFrontend.FRONTEND_URL = 'http://app.example.test'
  assert.throws(() => validateEnvironment(insecureFrontend), /FRONTEND_URL must be a public HTTPS origin/)

  const insecureCallback = productionConfiguration()
  insecureCallback.GITHUB_CALLBACK_URL = 'http://api.example.test/api/auth/github/callback'
  assert.throws(() => validateEnvironment(insecureCallback), /GITHUB_CALLBACK_URL must be a public HTTPS URL/)
})

test('rejects loopback IPv6 production dependencies', () => {
  const localDatabase = productionConfiguration()
  localDatabase.DATABASE_URL = 'postgresql://app:password@[::1]:5432/app'
  assert.throws(() => validateEnvironment(localDatabase), /DATABASE_URL must not point to a local host/)

  const localRedis = productionConfiguration()
  localRedis.REDIS_URL = 'rediss://redis@[::1]:6380'
  assert.throws(() => validateEnvironment(localRedis), /REDIS_URL must not point to a local host/)
})
