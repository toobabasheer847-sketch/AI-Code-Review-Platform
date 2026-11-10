import express, { Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from '@/config/env';
import {
  apiLimiter,
  loginRegistrationLimiter,
  registrationLimiter,
  resolveTrustProxySetting,
} from '@/middleware/rate-limit';
import logger from '@/utils/logger';
import { errorMiddleware } from '@/middleware/error.middleware';
import { apiSecurityMiddleware } from '@/middleware/api-security.middleware';
import { corsMiddleware } from '@/middleware/cors.middleware';
import { createApiRoutes } from '@/routes';
import { prisma } from '@/config/database';
import { redis } from '@/config/redis';
import { reviewQueue } from '@/jobs/review.queue';
import { emailQueue } from '@/jobs/email.queue';
import { automationQueue } from '@/modules/automation/automation.queue';
import { getAutomationSchedulerHealth } from '@/modules/automation/automation.scheduler';
import { socialQueue } from '@/modules/social/social.queue';
import { fixVerificationQueue } from '@/jobs/fix-verification.queue';
import { evaluateAlerts, takeNewlyTriggeredAlerts } from '@/observability/alerts';
import { authorizeMetricsRequest, buildMonitoringDashboard } from '@/observability/dashboard';
import { checkDependencyHealth } from '@/observability/health';
import { metricsSnapshot, recordDependencyStatus, recordHttpObservation } from '@/observability/metrics';
import { requestContextMiddleware, requestLogBindings } from '@/observability/request-context';

export const createApp = (): Express => {
  const app = express();
  const trustProxy = resolveTrustProxySetting();
  app.set('trust proxy', trustProxy);
  if (env.NODE_ENV === 'production' && trustProxy === false) {
    logger.warn(
      'TRUST_PROXY_HOPS is unset. X-Forwarded-For is ignored so a spoofed client address cannot bypass rate limits. Set TRUST_PROXY_HOPS to the exact number of trusted proxies in front of this process.'
    );
  }

  app.use(helmet());
  app.use(corsMiddleware);
  app.use(requestContextMiddleware);
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      recordHttpObservation({
        at: Date.now(),
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
      });
    });
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id ?? '',
      customProps: (req, res) => ({
        ...requestLogBindings(req),
        statusCode: res.statusCode,
      }),
      customAttributeKeys: {
        responseTime: 'durationMs',
      },
      serializers: {
        req(request) {
          return requestLogBindings(request);
        },
      },
    })
  );
  app.use('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }));
  app.use('/api/webhooks/github', express.raw({ type: 'application/json', limit: '1mb' }));
  app.use(
    '/api/reviews/internal/verification-callback',
    express.raw({ type: 'application/json', limit: '128kb' })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  app.use('/api/', apiLimiter);
  app.use('/api/auth/login', loginRegistrationLimiter);
  app.use('/api/auth/register', registrationLimiter);
  app.use('/api', apiSecurityMiddleware);

  app.get('/health/live', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const readinessHandler = async (_req: express.Request, res: express.Response): Promise<void> => {
    const dependencies = await checkDependencyHealth({
      database: () => prisma.$queryRaw`SELECT 1`,
      redis: () => redis.ping(),
    });
    recordDependencyStatus('database', dependencies.database);
    recordDependencyStatus('redis', dependencies.redis);
    const opened = takeNewlyTriggeredAlerts(
      evaluateAlerts({
        live: 'ok',
        database: dependencies.database,
        redis: dependencies.redis,
        snapshot: metricsSnapshot(),
      })
    );
    for (const alert of opened) {
      logger.warn({ alert: alert.id }, 'Monitoring alert threshold crossed');
    }
    if (dependencies.database !== 'ok' || dependencies.redis !== 'ok') {
      logger.error(
        { database: dependencies.database, redis: dependencies.redis },
        'Readiness health check failed'
      );
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        dependencies: { ...dependencies, queues: 'unknown' },
      });
      return;
    }

    try {
      const [reviewJobs, emailJobs, automationJobs, socialJobs, verificationJobs] =
        await Promise.all([
          reviewQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          emailQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          automationQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          socialQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          fixVerificationQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
        ]);
      const scheduler = getAutomationSchedulerHealth();
      const schedulerStatus = !scheduler.running
        ? 'starting'
        : scheduler.lastFailureType
          ? 'degraded'
          : 'ok';
      res.json({
        status: schedulerStatus === 'degraded' ? 'degraded' : 'ok',
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
        dependencies: {
          database: 'ok',
          redis: 'ok',
          queues: 'ok',
          scheduler: schedulerStatus,
        },
        queues: {
          reviews: reviewJobs,
          email: emailJobs,
          automations: automationJobs,
          socialPublications: socialJobs,
          fixVerification: verificationJobs,
        },
        scheduler,
      });
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Readiness health check failed'
      );
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        dependencies: { database: 'ok', redis: 'ok', queues: 'unavailable' },
      });
    }
  };

  app.get('/health/ready', readinessHandler);
  app.get('/health', readinessHandler);
  app.get('/metrics', (req, res) => {
    const authorization = authorizeMetricsRequest(
      req.header('authorization'),
      process.env.METRICS_TOKEN ?? ''
    );
    if (authorization === 'not-configured') {
      res.status(404).json({ error: { status: 404, message: 'Not found' } });
      return;
    }
    if (authorization === 'rejected') {
      res.status(401).json({ error: { status: 401, message: 'Unauthorized' } });
      return;
    }
    res.json(
      buildMonitoringDashboard({
        live: 'ok',
        ready:
          metricsSnapshot().dependencies.database === 'ok' &&
          metricsSnapshot().dependencies.redis === 'ok'
            ? 'ok'
            : 'error',
        snapshot: metricsSnapshot(),
      })
    );
  });

  app.use('/api', createApiRoutes());

  app.use(errorMiddleware);

  return app;
};
