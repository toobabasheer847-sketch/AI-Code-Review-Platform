import axios, { type AxiosInstance } from 'axios';
import { SocialPostStatus, SocialProvider } from '@prisma/client';
import { prisma } from '@/config/database';
import { env } from '@/config/env';
import { decrypt, encrypt } from '@/utils/crypto';
import { SocialProviderError } from './social.provider';

const REQUIRED_SCOPES = ['openid', 'profile', 'w_member_social'] as const;

interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
}

interface LinkedInProfile {
  sub: string;
  name?: string;
}

export function isLinkedInConfigured(): boolean {
  return Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET);
}

export class LinkedInService {
  constructor(private readonly http: AxiosInstance = axios.create({ timeout: 15_000 })) {}

  getAuthorizeUrl(state: string): string {
    this.assertConfigured();
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: env.LINKEDIN_CLIENT_ID,
      redirect_uri: env.LINKEDIN_CALLBACK_URL,
      state,
      scope: REQUIRED_SCOPES.join(' '),
    }).toString();
    return url.toString();
  }

  async completeAuthorization(code: string, userId: string): Promise<void> {
    this.assertConfigured();
    let tokenResponse: LinkedInTokenResponse;
    try {
      const response = await this.http.post<LinkedInTokenResponse>(
        'https://www.linkedin.com/oauth/v2/accessToken',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: env.LINKEDIN_CALLBACK_URL,
          client_id: env.LINKEDIN_CLIENT_ID,
          client_secret: env.LINKEDIN_CLIENT_SECRET,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      tokenResponse = response.data;
    } catch {
      throw new SocialProviderError(
        'LinkedIn authorization could not be completed. Check the app credentials and callback URL.',
        'OAUTH_EXCHANGE_FAILED'
      );
    }

    const grantedScopes = this.parseScopes(tokenResponse.scope);
    if (
      typeof tokenResponse.access_token !== 'string' ||
      !Number.isSafeInteger(tokenResponse.expires_in) ||
      tokenResponse.expires_in <= 0 ||
      tokenResponse.expires_in > 366 * 24 * 60 * 60 ||
      REQUIRED_SCOPES.some((scope) => !grantedScopes.includes(scope))
    ) {
      throw new SocialProviderError(
        'LinkedIn did not grant all required OpenID and w_member_social permissions.',
        'MISSING_PERMISSION'
      );
    }

    let profile: LinkedInProfile;
    try {
      const response = await this.http.get<LinkedInProfile>('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
      });
      profile = response.data;
    } catch {
      throw new SocialProviderError(
        'LinkedIn account identity could not be verified.',
        'IDENTITY_LOOKUP_FAILED'
      );
    }
    if (typeof profile.sub !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(profile.sub)) {
      throw new SocialProviderError('LinkedIn returned an invalid member identity.', 'INVALID_IDENTITY');
    }

    await prisma.socialAccount.upsert({
      where: {
        userId_provider_providerAccountId: {
          userId,
          provider: SocialProvider.LINKEDIN,
          providerAccountId: profile.sub,
        },
      },
      create: {
        userId,
        provider: SocialProvider.LINKEDIN,
        providerAccountId: profile.sub,
        displayName: (profile.name ?? 'LinkedIn member').slice(0, 200),
        accessToken: encrypt(tokenResponse.access_token),
        scopes: grantedScopes,
        tokenExpiresAt: new Date(Date.now() + tokenResponse.expires_in * 1_000),
        lastSuccessfulConnectionCheckAt: new Date(),
      },
      update: {
        displayName: (profile.name ?? 'LinkedIn member').slice(0, 200),
        accessToken: encrypt(tokenResponse.access_token),
        scopes: grantedScopes,
        tokenExpiresAt: new Date(Date.now() + tokenResponse.expires_in * 1_000),
        lastSuccessfulConnectionCheckAt: new Date(),
      },
    });
  }

  async listAccounts(userId: string) {
    const accounts = await prisma.socialAccount.findMany({
      where: { userId, provider: SocialProvider.LINKEDIN },
      select: {
        id: true,
        provider: true,
        providerAccountId: true,
        displayName: true,
        scopes: true,
        tokenExpiresAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return accounts.map((account) => ({
      ...account,
      connected: account.tokenExpiresAt.getTime() > Date.now(),
      canPublish:
        account.tokenExpiresAt.getTime() > Date.now() &&
        account.scopes.includes('w_member_social'),
    }));
  }

  async getAccessToken(userId: string, accountId: string) {
    const account = await prisma.socialAccount.findFirst({
      where: { id: accountId, userId, provider: SocialProvider.LINKEDIN },
    });
    if (!account) {
      throw new SocialProviderError('The selected LinkedIn account is not connected to this user.', 'ACCOUNT_NOT_FOUND');
    }
    if (account.tokenExpiresAt.getTime() <= Date.now()) {
      throw new SocialProviderError('LinkedIn authorization expired. Reconnect the account.', 'TOKEN_EXPIRED');
    }
    if (!account.scopes.includes('w_member_social')) {
      throw new SocialProviderError('The account lacks w_member_social permission. Reconnect after enabling Share on LinkedIn.', 'MISSING_PERMISSION');
    }
    try {
      return {
        account,
        accessToken: decrypt(account.accessToken),
      };
    } catch {
      throw new SocialProviderError('Stored LinkedIn authorization cannot be decrypted. Reconnect the account.', 'TOKEN_UNAVAILABLE');
    }
  }

  async checkConnection(userId: string, accountId: string): Promise<{ checkedAt: Date }> {
    const { account, accessToken } = await this.getAccessToken(userId, accountId)
    let profile: LinkedInProfile
    try {
      const response = await this.http.get<LinkedInProfile>('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      profile = response.data
    } catch {
      throw new SocialProviderError(
        'LinkedIn authorization could not be verified. Reconnect the account if this continues.',
        'CONNECTION_CHECK_FAILED'
      )
    }
    if (profile.sub !== account.providerAccountId) {
      throw new SocialProviderError('LinkedIn returned a different account identity.', 'IDENTITY_MISMATCH')
    }
    const checkedAt = new Date()
    await prisma.socialAccount.updateMany({
      where: { id: account.id, userId, provider: SocialProvider.LINKEDIN },
      data: { lastSuccessfulConnectionCheckAt: checkedAt },
    })
    return { checkedAt }
  }

  async disconnect(userId: string, accountId: string): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      const account = await transaction.socialAccount.findFirst({
        where: { id: accountId, userId, provider: SocialProvider.LINKEDIN },
        select: { id: true },
      });
      if (!account) {
        throw new SocialProviderError('The selected LinkedIn account was not found.', 'ACCOUNT_NOT_FOUND');
      }
      const pendingPosts = await transaction.socialPost.findMany({
        where: {
          userId,
          accountId,
          status: { in: [SocialPostStatus.AWAITING_APPROVAL, SocialPostStatus.SCHEDULED] },
        },
        select: { id: true },
      });
      for (const { id } of pendingPosts) {
        const changed = await transaction.socialPost.updateMany({
          where: {
            id,
            userId,
            accountId,
            status: { in: [SocialPostStatus.AWAITING_APPROVAL, SocialPostStatus.SCHEDULED] },
          },
          data: {
            status: SocialPostStatus.CANCELED,
            approvalHash: null,
            errorCode: 'ACCOUNT_DISCONNECTED',
            errorMessage: 'Publishing was canceled because this LinkedIn account was disconnected.',
          },
        });
        if (changed.count === 1) {
          await transaction.socialPostEvent.create({
            data: {
              postId: id,
              userId,
              type: 'account_disconnected',
              message: 'Pending publication canceled because the account was disconnected.',
            },
          });
        }
      }
      await transaction.socialAccount.delete({ where: { id: accountId } });
    });
  }

  private parseScopes(value: unknown): string[] {
    if (typeof value !== 'string') return [];
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      decoded = value;
    }
    return decoded.split(/\s+/).filter(Boolean);
  }

  private assertConfigured(): void {
    if (!isLinkedInConfigured()) {
      throw new SocialProviderError(
        'LinkedIn publishing is not configured. Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET, enable Share on LinkedIn, and register LINKEDIN_CALLBACK_URL.',
        'PROVIDER_NOT_CONFIGURED'
      );
    }
  }
}
