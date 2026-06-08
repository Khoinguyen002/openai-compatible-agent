import * as Sentry from '@sentry/node';
import type { Logger } from 'pino';

export function initSentry(dsn: string | undefined, env: string, logger?: Logger) {
  if (!dsn) {
    logger?.debug('Sentry DSN not set — error tracking disabled');
    return;
  }
  Sentry.init({
    dsn: dsn,
    environment: env,
    tracesSampleRate: 0.1,
  });
  logger?.info('Sentry initialized');
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
