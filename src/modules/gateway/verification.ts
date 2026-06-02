import { config } from '../../config/index.js';

/**
 * Validates the X-Telegram-Bot-Api-Secret-Token header on every inbound
 * webhook POST. Requests without a valid token are rejected before any
 * further processing occurs.
 */
export function verifyWebhookSecret(headerValue: string | undefined): boolean {
  if (!headerValue) return false;
  // Constant-time comparison to resist timing attacks
  const expected = config.TELEGRAM_WEBHOOK_SECRET;
  if (headerValue.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= headerValue.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
