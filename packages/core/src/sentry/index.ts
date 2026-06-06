import * as Sentry from '@sentry/node';
import { config } from '../config/index.js';
import { logger } from '../logger/index.js';

export function initSentry() {
  if (!config.SENTRY_DSN) {
    logger.debug('Sentry DSN not set — error tracking disabled');
    return;
  }
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    tracesSampleRate: 0.1,
  });
  logger.info('Sentry initialized');
}

export function captureException(
  err: unknown,
  context: Record<string, unknown> = {},
) {
  Sentry.withScope(scope => {
    Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
    Sentry.captureException(err);
  });
}
