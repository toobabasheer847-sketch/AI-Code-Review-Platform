import assert from 'node:assert/strict';
import axios, { type AxiosAdapter, type AxiosResponse } from 'axios';
import test from 'node:test';
import { env } from '@/config/env';
import { LinkedInService } from './linkedin.service';
import { SocialProviderError } from './social.provider';

function response<T>(
  config: Parameters<AxiosAdapter>[0],
  data: T
): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

test('LinkedIn OAuth requests least-privilege member posting scopes and uses configured redirect', () => {
  const previousId = env.LINKEDIN_CLIENT_ID;
  const previousSecret = env.LINKEDIN_CLIENT_SECRET;
  const previousCallback = env.LINKEDIN_CALLBACK_URL;
  try {
    env.LINKEDIN_CLIENT_ID = 'test-client';
    env.LINKEDIN_CLIENT_SECRET = 'test-secret';
    env.LINKEDIN_CALLBACK_URL = 'https://app.example/api/social/linkedin/callback';
    const url = new URL(new LinkedInService().getAuthorizeUrl('random-state'));
    assert.equal(url.origin, 'https://www.linkedin.com');
    assert.equal(url.pathname, '/oauth/v2/authorization');
    assert.equal(url.searchParams.get('client_id'), 'test-client');
    assert.equal(url.searchParams.get('redirect_uri'), env.LINKEDIN_CALLBACK_URL);
    assert.equal(url.searchParams.get('state'), 'random-state');
    assert.deepEqual(
      url.searchParams.get('scope')?.split(' '),
      ['openid', 'profile', 'w_member_social']
    );
  } finally {
    env.LINKEDIN_CLIENT_ID = previousId;
    env.LINKEDIN_CLIENT_SECRET = previousSecret;
    env.LINKEDIN_CALLBACK_URL = previousCallback;
  }
});

test('LinkedIn connection rejects tokens without the posting scope before loading account identity', async () => {
  const previousId = env.LINKEDIN_CLIENT_ID;
  const previousSecret = env.LINKEDIN_CLIENT_SECRET;
  const previousCallback = env.LINKEDIN_CALLBACK_URL;
  let apiCalls = 0;
  try {
    env.LINKEDIN_CLIENT_ID = 'test-client';
    env.LINKEDIN_CLIENT_SECRET = 'test-secret';
    env.LINKEDIN_CALLBACK_URL = 'https://app.example/api/social/linkedin/callback';
    const service = new LinkedInService(
      axios.create({
        adapter: async (config) => {
          apiCalls += 1;
          return response(config, {
            access_token: 'token-that-must-not-be-stored',
            expires_in: 3_600,
            scope: 'openid profile',
          });
        },
      })
    );
    await assert.rejects(
      service.completeAuthorization('authorization-code', 'user-a'),
      (error: unknown) =>
        error instanceof SocialProviderError &&
        error.code === 'MISSING_PERMISSION' &&
        !error.message.includes('token-that-must-not-be-stored')
    );
    assert.equal(apiCalls, 1);
  } finally {
    env.LINKEDIN_CLIENT_ID = previousId;
    env.LINKEDIN_CLIENT_SECRET = previousSecret;
    env.LINKEDIN_CALLBACK_URL = previousCallback;
  }
});

test('LinkedIn connect stays unavailable until both app credentials are configured', () => {
  const previousId = env.LINKEDIN_CLIENT_ID;
  const previousSecret = env.LINKEDIN_CLIENT_SECRET;
  try {
    env.LINKEDIN_CLIENT_ID = '';
    env.LINKEDIN_CLIENT_SECRET = '';
    assert.throws(
      () => new LinkedInService().getAuthorizeUrl('state'),
      (error: unknown) =>
        error instanceof SocialProviderError && error.code === 'PROVIDER_NOT_CONFIGURED'
    );
  } finally {
    env.LINKEDIN_CLIENT_ID = previousId;
    env.LINKEDIN_CLIENT_SECRET = previousSecret;
  }
});
