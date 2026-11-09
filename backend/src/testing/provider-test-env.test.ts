import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ProviderTestEnvironmentError,
  readGitHubIntegrationTarget,
  readOpenAIIntegrationKey,
  readSmtpIntegrationTarget,
  readStripeIntegrationTarget,
} from './provider-test-env'

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('provider integration stays disabled until each opt-in flag is set', () => {
  withEnv(
    {
      RUN_GITHUB_INTEGRATION_TEST: undefined,
      RUN_OPENAI_INTEGRATION_TEST: undefined,
      RUN_STRIPE_INTEGRATION_TEST: undefined,
      GITHUB_INTEGRATION_TOKEN: 'dedicated-test-token-value-123456',
      OPENAI_INTEGRATION_API_KEY: 'dedicated-openai-key-value-123456',
      STRIPE_INTEGRATION_SECRET_KEY: 'sk_test_dedicated_value_123456',
      SMTP_INTEGRATION_HOST: undefined,
    },
    () => {
      assert.equal(readGitHubIntegrationTarget(), undefined)
      assert.equal(readOpenAIIntegrationKey(), undefined)
      assert.equal(readStripeIntegrationTarget(), undefined)
      assert.equal(readSmtpIntegrationTarget(), undefined)
    }
  )
})

test('rejects live Stripe keys and placeholder provider credentials without recording them', () => {
  withEnv(
    {
      RUN_STRIPE_INTEGRATION_TEST: '1',
      STRIPE_INTEGRATION_SECRET_KEY: 'sk_live_secret_value_should_not_leak',
    },
    () => {
      assert.throws(
        () => readStripeIntegrationTarget(),
        (error: unknown) => {
          assert.ok(error instanceof ProviderTestEnvironmentError)
          assert.equal(error.message.includes('sk_live_secret_value_should_not_leak'), false)
          assert.match(error.message, /live secret key/)
          return true
        }
      )
    }
  )
  withEnv(
    {
      RUN_OPENAI_INTEGRATION_TEST: '1',
      OPENAI_INTEGRATION_API_KEY: 'sk-invalid-should-not-leak',
    },
    () => {
      assert.throws(() => readOpenAIIntegrationKey(), /was not recorded/)
    }
  )
})

test('accepts only a localhost Mailpit endpoint', () => {
  withEnv(
    {
      SMTP_INTEGRATION_HOST: 'mail.example.com',
      SMTP_INTEGRATION_PORT: '1025',
      SMTP_INTEGRATION_API_URL: 'http://127.0.0.1:8025',
    },
    () => {
      assert.throws(() => readSmtpIntegrationTarget(), /localhost/)
    }
  )
  withEnv(
    {
      SMTP_INTEGRATION_HOST: '127.0.0.1',
      SMTP_INTEGRATION_PORT: '1025',
      SMTP_INTEGRATION_API_URL: 'http://127.0.0.1:8025/',
    },
    () => {
      assert.deepEqual(readSmtpIntegrationTarget(), {
        host: '127.0.0.1',
        port: 1025,
        apiUrl: 'http://127.0.0.1:8025',
      })
    }
  )
})
