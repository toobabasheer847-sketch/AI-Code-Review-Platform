import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '@/config/env';
import { decrypt, encrypt } from '@/utils/crypto';
import logger from '@/utils/logger';
import { SocialService, SocialServiceError } from './social.service';
import { LinkedInService } from './linkedin.service';
import { SocialProviderError } from './social.provider';

const socialService = new SocialService();
const linkedinService = new LinkedInService();

const dateSchema = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const draftSchema = z
  .object({
    content: z.string().min(1).max(3_000),
    accountId: z.string().cuid().optional(),
    scheduledAt: dateSchema.nullable().optional(),
  })
  .strict();
const generatedDraftSchema = z
  .object({
    instructions: z.string().trim().min(1).max(2_000),
    reviewId: z.string().min(1).max(100),
  })
  .strict();
const updateSchema = z
  .object({
    content: z.string().min(1).max(3_000),
    accountId: z.string().cuid().nullable(),
    scheduledAt: dateSchema.nullable(),
  })
  .strict();

function getUserId(req: Request, res: Response): string | null {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return userId;
}

function readCookie(req: Request, name: string): string | null {
  const item = req.headers.cookie
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  if (!item) return null;
  try {
    return decodeURIComponent(item.slice(name.length + 1));
  } catch {
    return null;
  }
}

export class SocialController {
  async status(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      res.json(await socialService.getStatus(userId));
    } catch (error) {
      this.handleError(error, res, 'Unable to load social account status.');
    }
  }

  async posts(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      res.json(await socialService.listPosts(userId));
    } catch (error) {
      this.handleError(error, res, 'Unable to load social posts.');
    }
  }

  async connectLinkedIn(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const state = crypto.randomBytes(32).toString('hex');
      const authorizeUrl = linkedinService.getAuthorizeUrl(state);
      const cookieOptions = {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        maxAge: 5 * 60 * 1_000,
        path: '/api/social/linkedin/callback',
      };
      res.cookie('social_linkedin_state', state, cookieOptions);
      res.cookie('social_linkedin_user', encrypt(userId), cookieOptions);
      res.json({ url: authorizeUrl });
    } catch (error) {
      this.handleError(error, res, 'LinkedIn connection is not configured.');
    }
  }

  async linkedinCallback(req: Request, res: Response): Promise<void> {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const cookieState = readCookie(req, 'social_linkedin_state');
    const cookieUser = readCookie(req, 'social_linkedin_user');
    const clearCookie = { path: '/api/social/linkedin/callback' };
    res.clearCookie('social_linkedin_state', clearCookie);
    res.clearCookie('social_linkedin_user', clearCookie);
    try {
      if (!state || !code || !cookieState || state !== cookieState || !cookieUser) {
        throw new SocialProviderError('LinkedIn authorization state is invalid or expired.', 'INVALID_OAUTH_STATE');
      }
      const userId = decrypt(cookieUser);
      await linkedinService.completeAuthorization(code, userId);
      res.redirect(`${env.FRONTEND_URL}/social?linkedin=connected`);
    } catch (error) {
      logger.warn(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'LinkedIn OAuth callback could not be completed'
      );
      const reason =
        error instanceof SocialProviderError
          ? error.message
          : 'LinkedIn connection failed. Review the app permissions and try again.';
      res.redirect(`${env.FRONTEND_URL}/social?linkedin=error&message=${encodeURIComponent(reason)}`);
    }
  }

  async disconnectAccount(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      await linkedinService.disconnect(userId, req.params.accountId ?? '');
      res.json({ message: 'LinkedIn account disconnected. Published history was retained.' });
    } catch (error) {
      this.handleError(error, res, 'Unable to disconnect the LinkedIn account.');
    }
  }

  async generateDraft(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req, res);
    if (!userId) return;
    const parsed = generatedDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide instructions and an owned completed review as evidence.' });
      return;
    }
    try {
      const idempotencyKey = this.idempotencyKey(req, res);
      if (res.headersSent) return;
      const post = await socialService.generateDraft(userId, {
        ...parsed.data,
        idempotencyKey,
      });
      res.status(201).json(post);
    } catch (error) {
      this.handleError(error, res, 'Unable to generate a social post draft.');
    }
  }

  async createDraft(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req, res);
    if (!userId) return;
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid LinkedIn draft.' });
      return;
    }
    try {
      const idempotencyKey = this.idempotencyKey(req, res);
      if (res.headersSent) return;
      const post = await socialService.createDraft(userId, {
        ...parsed.data,
        idempotencyKey,
      });
      res.status(201).json(post);
    } catch (error) {
      this.handleError(error, res, 'Unable to save the social post draft.');
    }
  }

  async updatePost(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req, res);
    if (!userId) return;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid social post update.' });
      return;
    }
    try {
      res.json(await socialService.updateDraft(userId, req.params.postId ?? '', parsed.data));
    } catch (error) {
      this.handleError(error, res, 'Unable to update the social post.');
    }
  }

  async requestApproval(req: Request, res: Response): Promise<void> {
    await this.postAction(req, res, (userId, id) => socialService.requestApproval(userId, id));
  }

  async approve(req: Request, res: Response): Promise<void> {
    await this.postAction(req, res, (userId, id) => socialService.approve(userId, id));
  }

  async reject(req: Request, res: Response): Promise<void> {
    await this.postAction(req, res, (userId, id) => socialService.reject(userId, id));
  }

  async cancel(req: Request, res: Response): Promise<void> {
    await this.postAction(req, res, (userId, id) => socialService.cancel(userId, id));
  }

  async retry(req: Request, res: Response): Promise<void> {
    await this.postAction(req, res, (userId, id) => socialService.retry(userId, id));
  }

  private async postAction(
    req: Request,
    res: Response,
    action: (userId: string, postId: string) => Promise<unknown>
  ): Promise<void> {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      res.json(await action(userId, req.params.postId ?? ''));
    } catch (error) {
      this.handleError(error, res, 'Unable to update this social post.');
    }
  }

  private idempotencyKey(req: Request, res: Response): string | undefined {
    const key = req.get('Idempotency-Key');
    if (!key) return undefined;
    if (key.trim().length === 0 || key.length > 100) {
      res.status(400).json({ error: 'Invalid Idempotency-Key header.' });
      return undefined;
    }
    return key;
  }

  private handleError(error: unknown, res: Response, fallback: string): void {
    if (error instanceof SocialServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    if (error instanceof SocialProviderError) {
      const status =
        error.code === 'PROVIDER_NOT_CONFIGURED'
          ? 503
          : error.code === 'MISSING_PERMISSION' || error.code === 'PERMISSION_DENIED'
            ? 403
            : error.code === 'ACCOUNT_NOT_FOUND'
              ? 404
              : 502;
      res.status(status).json({ error: error.message });
      return;
    }
    logger.error(
      { errorType: error instanceof Error ? error.name : 'UnknownError' },
      fallback
    );
    res.status(500).json({ error: fallback });
  }
}
