import axios, { type AxiosInstance } from 'axios';
import { env } from '@/config/env';

export interface SocialPublishRequest {
  accessToken: string;
  authorId: string;
  content: string;
}

export interface SocialPublishReceipt {
  postId: string;
  url: string;
}

export interface SocialProvider {
  readonly id: string;
  readonly name: string;
  readonly maxCharacters: number;
  publish(input: SocialPublishRequest): Promise<SocialPublishReceipt>;
}

export class SocialProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly safeToRetry = false,
    readonly ambiguous = false,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'SocialProviderError';
  }
}

export class LinkedInProvider implements SocialProvider {
  readonly id = 'LINKEDIN' as const;
  readonly name = 'LinkedIn';
  readonly maxCharacters = 3_000;

  constructor(
    private readonly api: AxiosInstance = axios.create({ timeout: 15_000 }),
    private readonly apiVersion: string = env.LINKEDIN_API_VERSION
  ) {}

  async publish(input: SocialPublishRequest): Promise<SocialPublishReceipt> {
    let response;
    try {
      response = await this.api.post<{ id?: string }>(
        'https://api.linkedin.com/rest/posts',
        {
          author: `urn:li:person:${input.authorId}`,
          commentary: input.content,
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        },
        {
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            'Content-Type': 'application/json',
            'Linkedin-Version': this.apiVersion,
            'X-Restli-Protocol-Version': '2.0.0',
          },
        }
      );
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 429) {
        const responseError = axios.isAxiosError(error) ? error : undefined;
        const retryHeader = responseError?.response?.headers?.['retry-after'];
        const retryAfterSeconds = Number(retryHeader);
        throw new SocialProviderError(
          'LinkedIn rate-limited this post. A safe retry may be scheduled.',
          'RATE_LIMITED',
          true,
          false,
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? Math.min(retryAfterSeconds, 60 * 60)
            : 60
        );
      }
      if (status === 401) {
        throw new SocialProviderError(
          'LinkedIn authorization expired or was revoked. Reconnect the account.',
          'TOKEN_INVALID'
        );
      }
      if (status === 403) {
        throw new SocialProviderError(
          'LinkedIn denied publishing. Confirm the Share on LinkedIn product and w_member_social permission.',
          'PERMISSION_DENIED'
        );
      }
      if (status === 404) {
        throw new SocialProviderError(
          'LinkedIn could not find the authorized member or post endpoint.',
          'PROVIDER_RESOURCE_NOT_FOUND'
        );
      }
      if (status !== undefined && status >= 400 && status < 500) {
        throw new SocialProviderError(
          `LinkedIn rejected the post (HTTP ${status}). Review the content and account permissions.`,
          'PROVIDER_REJECTED'
        );
      }
      throw new SocialProviderError(
        'LinkedIn did not confirm whether the post was created. Verify the account before retrying.',
        'PUBLICATION_OUTCOME_UNKNOWN',
        false,
        true
      );
    }

    const responseId =
      response.headers['x-restli-id'] ??
      response.headers['X-RestLi-Id'] ??
      response.data.id;
    if (response.status !== 201 || typeof responseId !== 'string' || !/^urn:li:(share|ugcPost):[\w-]+$/.test(responseId)) {
      throw new SocialProviderError(
        'LinkedIn returned no verifiable post identifier. Verify the account before retrying.',
        'PUBLICATION_OUTCOME_UNKNOWN',
        false,
        true
      );
    }
    return {
      postId: responseId,
      url: `https://www.linkedin.com/feed/update/${responseId}/`,
    };
  }
}

export class SocialProviderRegistry {
  private readonly providers: ReadonlyMap<string, SocialProvider>;

  constructor(providers: SocialProvider[] = [new LinkedInProvider()]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  get(provider: string): SocialProvider {
    const implementation = this.providers.get(provider);
    if (!implementation) throw new SocialProviderError('This social platform is not supported.', 'UNSUPPORTED_PROVIDER');
    return implementation;
  }
}
