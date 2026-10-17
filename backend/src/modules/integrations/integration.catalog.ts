import { SocialProvider } from '@prisma/client';
import { env } from '@/config/env';
import { automationActionCatalog } from '@/modules/automation/automation.domain';
import { prisma } from '@/config/database';

export const integrationProviders = [
  {
    id: 'github',
    name: 'GitHub',
    summary: 'Repository review, development context, issue creation, and pull request comments.',
    requiredPermissions: ['repo'],
    setupInstructions: [
      'Configure GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and GITHUB_CALLBACK_URL on the backend.',
      'Register the callback URL in the GitHub OAuth App settings.',
      'Connect or reconnect GitHub to verify the authorization and account identity.',
    ],
    limitations: [
      'GitHub OAuth classic repo scope can grant broad access to repositories available to the account; repository-specific scope selection is not supported by this OAuth flow.',
      'Organization SSO or policy restrictions can deny repository access even when OAuth succeeds.',
      'Pull request review submission and repository file changes are not available workflow actions. Write retries use task-key markers, but a provider visibility delay can require manual verification.',
    ],
    actions: automationActionCatalog.filter((action) => action.provider === 'github'),
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    summary: 'Create member text-post drafts and publish them after explicit approval.',
    requiredPermissions: ['openid', 'profile', 'w_member_social'],
    setupInstructions: [
      'Create a LinkedIn developer app and enable Sign In with LinkedIn using OpenID Connect and Share on LinkedIn.',
      'Register LINKEDIN_CALLBACK_URL as an authorized redirect URL.',
      'Configure LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET on the backend.',
      'Reconnect and grant the requested permissions. LinkedIn access tokens expire; reconnect when authorization expires.',
    ],
    limitations: [
      'Only member-authored text posts are implemented; organization publishing, media, and native platform scheduling are unavailable.',
      'Publishing requires the LinkedIn app to have the Share on LinkedIn product approved and the w_member_social permission.',
      'Posts with ambiguous provider outcomes are not retried automatically.',
    ],
    actions: [
      {
        id: 'linkedin_publish_approved_member_post',
        provider: 'linkedin',
        name: 'Publish approved member text post',
        description:
          'Publish a saved member text post only after its exact content, account, and schedule are approved.',
        inputSchema: {
          type: 'object',
          required: ['postId'],
          properties: { postId: { type: 'string', format: 'cuid' } },
          additionalProperties: false,
        },
        permissions: ['w_member_social'],
        retryBehavior:
          'Retry only when LinkedIn confirms no post was created; ambiguous outcomes require manual verification.',
        approvalRequired: true,
      },
    ],
  },
] as const;

export type IntegrationProviderId = (typeof integrationProviders)[number]['id'];

export class IntegrationCatalogService {
  async list(userId: string) {
    const [github, linkedinAccounts] = await Promise.all([
      prisma.gitHubAccount.findUnique({
        where: { userId },
        select: {
          githubId: true,
          username: true,
          scopes: true,
          lastSuccessfulConnectionCheckAt: true,
        },
      }),
      prisma.socialAccount.findMany({
        where: { userId, provider: SocialProvider.LINKEDIN },
        select: {
          id: true,
          providerAccountId: true,
          displayName: true,
          scopes: true,
          tokenExpiresAt: true,
          lastSuccessfulConnectionCheckAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return integrationProviders.map((provider) => {
      if (provider.id === 'github') {
        const configured = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
        return {
          ...provider,
          configured,
          connectionStatus: github
            ? provider.requiredPermissions.every((scope) => github.scopes.includes(scope))
              ? 'connected'
              : 'reconnect_required'
            : configured
              ? 'not_connected'
              : 'setup_required',
          authorizationStatus: github
            ? provider.requiredPermissions.every((scope) => github.scopes.includes(scope))
              ? 'verified'
              : 'permission_missing'
            : 'not_authorized',
          accounts: github
            ? [
                {
                  id: github.githubId,
                  displayName: github.username,
                  scopes: github.scopes,
                  lastSuccessfulConnectionCheckAt: github.lastSuccessfulConnectionCheckAt,
                },
              ]
            : [],
        };
      }

      const configured = Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET);
      const accounts = linkedinAccounts.map((account) => ({
        id: account.id,
        providerAccountId: account.providerAccountId,
        displayName: account.displayName,
        scopes: account.scopes,
        authorizationStatus:
          account.tokenExpiresAt.getTime() <= Date.now()
            ? 'expired'
            : !provider.requiredPermissions.every((scope) => account.scopes.includes(scope))
              ? 'permission_missing'
              : 'verified',
        lastSuccessfulConnectionCheckAt: account.lastSuccessfulConnectionCheckAt,
      }));
      return {
        ...provider,
        configured,
        connectionStatus: accounts.some((account) => account.authorizationStatus === 'verified')
          ? 'connected'
          : accounts.length > 0
            ? 'reconnect_required'
            : configured
              ? 'not_connected'
              : 'setup_required',
        authorizationStatus:
          accounts.length === 0
            ? 'not_authorized'
            : accounts.some((account) => account.authorizationStatus === 'verified')
              ? 'verified'
              : accounts.every((account) => account.authorizationStatus === 'expired')
                ? 'expired'
                : 'permission_missing',
        accounts,
      };
    });
  }
}
