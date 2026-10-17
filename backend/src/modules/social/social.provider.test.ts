import assert from 'node:assert/strict';
import axios, { type AxiosAdapter, type AxiosResponse } from 'axios';
import test from 'node:test';
import { socialPublishJobId } from './social.queue';
import { LinkedInProvider, SocialProviderError, SocialProviderRegistry } from './social.provider';

function response<T>(
  config: Parameters<AxiosAdapter>[0],
  data: T,
  status = 201,
  headers: Record<string, string> = {}
): AxiosResponse<T> {
  return { data, status, statusText: 'OK', headers, config };
}

function apiError(
  config: Parameters<AxiosAdapter>[0],
  status: number,
  headers: Record<string, string> = {}
): axios.AxiosError {
  return new axios.AxiosError(
    'provider body is sensitive',
    'ERR_BAD_REQUEST',
    config,
    undefined,
    { data: { access_token: 'secret' }, status, statusText: 'Failure', headers, config }
  );
}

test('LinkedIn publisher sends the documented member-post request and requires provider confirmation', async () => {
  let request: Parameters<AxiosAdapter>[0] | undefined;
  const provider = new LinkedInProvider(
    axios.create({
      adapter: async (config) => {
        request = config;
        return response(config, {}, 201, { 'x-restli-id': 'urn:li:share:12345' });
      },
    }),
    '202609'
  );
  const receipt = await provider.publish({
    accessToken: 'private-access-token',
    authorId: 'member-7',
    content: 'A reviewed software project update.',
  });
  assert.equal(receipt.postId, 'urn:li:share:12345');
  assert.equal(receipt.url, 'https://www.linkedin.com/feed/update/urn:li:share:12345/');
  assert.equal(request?.headers?.['Linkedin-Version'], '202609');
  assert.equal(request?.headers?.['X-Restli-Protocol-Version'], '2.0.0');
  assert.deepEqual(JSON.parse(String(request?.data)), {
    author: 'urn:li:person:member-7',
    commentary: 'A reviewed software project update.',
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  });
});

test('a LinkedIn 429 is a confirmed non-publication and permits a bounded safe retry', async () => {
  const provider = new LinkedInProvider(
    axios.create({
      adapter: async (config) => {
        throw apiError(config, 429, { 'retry-after': '17' });
      },
    })
  );
  await assert.rejects(
    provider.publish({ accessToken: 'secret', authorId: 'member-7', content: 'Post' }),
    (error: unknown) =>
      error instanceof SocialProviderError &&
      error.code === 'RATE_LIMITED' &&
      error.safeToRetry &&
      !error.ambiguous &&
      error.retryAfterSeconds === 17 &&
      !error.message.includes('secret')
  );
});

test('token and permission failures are explicit, and ambiguous failures are never retried', async () => {
  const unauthorizedProvider = new LinkedInProvider(
    axios.create({ adapter: async (config) => { throw apiError(config, 401); } })
  );
  await assert.rejects(
    unauthorizedProvider.publish({ accessToken: 'secret', authorId: 'member-7', content: 'Post' }),
    (error: unknown) => error instanceof SocialProviderError && error.code === 'TOKEN_INVALID'
  );

  const deniedProvider = new LinkedInProvider(
    axios.create({ adapter: async (config) => { throw apiError(config, 403); } })
  );
  await assert.rejects(
    deniedProvider.publish({ accessToken: 'secret', authorId: 'member-7', content: 'Post' }),
    (error: unknown) => error instanceof SocialProviderError && error.code === 'PERMISSION_DENIED'
  );

  const ambiguousProvider = new LinkedInProvider(
    axios.create({ adapter: async () => { throw new Error('network dropped'); } })
  );
  await assert.rejects(
    ambiguousProvider.publish({ accessToken: 'secret', authorId: 'member-7', content: 'Post' }),
    (error: unknown) =>
      error instanceof SocialProviderError &&
      error.ambiguous &&
      !error.safeToRetry &&
      error.code === 'PUBLICATION_OUTCOME_UNKNOWN'
  );
});

test('missing LinkedIn post confirmation is not returned as a successful publication', async () => {
  const provider = new LinkedInProvider(
    axios.create({ adapter: async (config) => response(config, {}, 200) })
  );
  await assert.rejects(
    provider.publish({ accessToken: 'secret', authorId: 'member-7', content: 'Post' }),
    (error: unknown) =>
      error instanceof SocialProviderError &&
      error.ambiguous &&
      error.code === 'PUBLICATION_OUTCOME_UNKNOWN'
  );
});

test('provider registry rejects unsupported platform writes', () => {
  const registry = new SocialProviderRegistry([]);
  assert.throws(
    () => registry.get('X'),
    (error: unknown) => error instanceof SocialProviderError && error.code === 'UNSUPPORTED_PROVIDER'
  );
});

test('duplicate jobs share a versioned key while reapproval receives a distinct key', () => {
  assert.equal(socialPublishJobId('post-1', 4), socialPublishJobId('post-1', 4));
  assert.notEqual(socialPublishJobId('post-1', 4), socialPublishJobId('post-1', 5));
});
