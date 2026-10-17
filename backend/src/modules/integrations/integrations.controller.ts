import type { Request, Response } from 'express';
import { z } from 'zod';
import { GitHubIntegrationError, GitHubService } from '@/modules/github/github.service';
import { LinkedInService } from '@/modules/social/linkedin.service';
import { SocialProviderError } from '@/modules/social/social.provider';
import logger from '@/utils/logger';
import { IntegrationCatalogService, integrationProviders } from './integration.catalog';

const catalog = new IntegrationCatalogService();
const github = new GitHubService();
const linkedin = new LinkedInService();
const checkSchema = z.object({ accountId: z.string().cuid().optional() }).strict();

export class IntegrationsController {
  async list(req: Request, res: Response): Promise<void> {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      res.json({ providers: await catalog.list(userId) });
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Integration catalog could not be loaded'
      );
      res.status(500).json({ error: 'Integration status could not be loaded.' });
    }
  }

  async check(req: Request, res: Response): Promise<void> {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const provider = integrationProviders.find((item) => item.id === req.params.provider);
    if (!provider) {
      res.status(404).json({ error: 'Integration provider is not supported.' });
      return;
    }
    const parsed = checkSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide a valid connected account for the check.' });
      return;
    }

    try {
      let check;
      if (provider.id === 'github') {
        if (parsed.data.accountId) {
          res
            .status(400)
            .json({ error: 'GitHub does not accept an account identifier for checks.' });
          return;
        }
        check = await github.checkConnection(userId);
      } else {
        if (!parsed.data.accountId) {
          res.status(400).json({ error: 'Select the LinkedIn account to check.' });
          return;
        }
        check = await linkedin.checkConnection(userId, parsed.data.accountId);
      }
      res.json({ provider: provider.id, status: 'verified', checkedAt: check.checkedAt });
    } catch (error) {
      const notFound =
        (error instanceof SocialProviderError && error.code === 'ACCOUNT_NOT_FOUND') ||
        (error instanceof GitHubIntegrationError && error.statusCode === 404);
      logger.warn(
        {
          provider: provider.id,
          errorType: error instanceof Error ? error.name : 'UnknownError',
          code: error instanceof SocialProviderError ? error.code : undefined,
        },
        'Integration connection check failed'
      );
      res.status(notFound ? 404 : 502).json({
        error: notFound
          ? 'The selected account is not connected to this user.'
          : 'The provider could not verify this connection. Reconnect if authorization has expired.',
      });
    }
  }
}
