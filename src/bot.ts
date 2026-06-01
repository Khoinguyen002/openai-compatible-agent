import { Bot, webhookCallback } from 'grammy';
import { randomUUID } from 'crypto';
import { config } from './config/index.js';
import { childLogger } from './logger.js';
import { captureException } from './sentry.js';
import { verifyWebhookSecret } from './gateway/verification.js';
import { checkRateLimit } from './gateway/rateLimit.js';
import { syncUser } from './gateway/userSync.js';
import { sessionQueue } from './queue/sessionQueue.js';
import { resolveOrCreateSession, rotateSession } from './orchestrator/session.js';
import { orchestrate } from './orchestrator/index.js';

const log = childLogger({ module: 'bot' });

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

// --- /start command ---
bot.command('start', async ctx => {
  await ctx.reply(
    'Hello! I am your AI assistant.\n\n' +
    'Send me any message to start a conversation.\n' +
    'Use /newchat to start a fresh session.',
  );
});

// --- /newchat command ---
bot.command('newchat', async ctx => {
  if (!ctx.from) return;
  const userId = BigInt(ctx.from.id);
  const chatId = BigInt(ctx.chat.id);

  await syncUser(ctx.from);
  await rotateSession(chatId, userId);
  await ctx.reply('New conversation started. Your previous context has been cleared.');
});

// --- Main message handler ---
bot.on('message:text', async ctx => {
  const requestId = randomUUID();
  const reqLog = log.child({ requestId });

  if (!ctx.from) {
    reqLog.warn('message without sender — ignoring');
    return;
  }

  const userId = BigInt(ctx.from.id);
  const chatId = BigInt(ctx.chat.id);
  const text = ctx.message.text.trim();

  reqLog.info(
    { userId: userId.toString(), chatId: chatId.toString(), preview: text.slice(0, 60) },
    'message received',
  );

  // Sync user profile
  await syncUser(ctx.from);

  // Rate limit check
  const rateResult = await checkRateLimit(userId);
  if (!rateResult.allowed) {
    await ctx.reply(rateResult.reason);
    return;
  }

  // Show typing indicator (best-effort, non-blocking)
  ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => undefined);

  // Resolve or create session
  const sessionId = await resolveOrCreateSession(chatId, userId);

  // Enqueue the agent job — serialized per session
  sessionQueue.enqueue(sessionId, async () => {
    try {
      // Keep typing indicator alive during long reasoning loops
      const typingInterval = setInterval(() => {
        ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => undefined);
      }, 4_000);

      let reply: string;
      try {
        const result = await orchestrate({ sessionId, userMessage: text, senderUserId: userId, requestId });
        reply = result.reply;
      } finally {
        clearInterval(typingInterval);
      }

      await ctx.reply(reply, { parse_mode: 'Markdown' }).catch(() =>
        // Fallback: send as plain text if Markdown parsing fails
        ctx.reply(reply),
      );
    } catch (err) {
      reqLog.error({ err }, 'agent job failed');
      captureException(err, { sessionId, requestId, userId: userId.toString() });
      await ctx.reply(
        'Sorry, something went wrong while processing your request. Please try again.',
      ).catch(() => undefined);
    }
  });
});

/**
 * Returns an Express-compatible webhook handler with secret verification.
 * The 200 ACK is sent immediately by grammY before the bot processes the update,
 * satisfying Telegram's 5-second timeout requirement.
 */
export function createWebhookHandler() {
  return async (req: import('http').IncomingMessage & { body?: unknown }, res: import('http').ServerResponse) => {
    const secret = (req.headers['x-telegram-bot-api-secret-token'] as string) || '';

    if (!verifyWebhookSecret(secret)) {
      log.warn({ ip: req.socket.remoteAddress }, 'webhook: invalid secret token — rejected');
      res.writeHead(401).end('Unauthorized');
      return;
    }

    return webhookCallback(bot, 'http')(req as never, res as never);
  };
}
