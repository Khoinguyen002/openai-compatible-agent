import { prisma } from '../../../db/client.js';
import { childLogger } from '../../logger/index.js';

const log = childLogger({ module: 'session' });

/**
 * Resolves the active chat session for a Telegram room.
 * If no active session exists, a new one is created automatically.
 */
export async function resolveOrCreateSession(
  telegramChatId: bigint,
  userId: bigint,
): Promise<string> {
  const existing = await prisma.chatSession.findFirst({
    where: { telegramChatId, endedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (existing) {
    log.debug({ sessionId: existing.id }, 'resumed active session');
    return existing.id;
  }

  const session = await prisma.chatSession.create({
    data: { telegramChatId, userId },
    select: { id: true },
  });

  log.info({ sessionId: session.id, telegramChatId: telegramChatId.toString() }, 'new session created');
  return session.id;
}

/**
 * Ends the current active session for a Telegram room and creates a fresh one.
 * Used by the /newchat command.
 * Returns the new session ID.
 */
export async function rotateSession(
  telegramChatId: bigint,
  userId: bigint,
): Promise<string> {
  // End all currently active sessions for this chat (defensive — should only be one)
  await prisma.chatSession.updateMany({
    where: { telegramChatId, endedAt: null },
    data: { endedAt: new Date() },
  });

  const session = await prisma.chatSession.create({
    data: { telegramChatId, userId },
    select: { id: true },
  });

  log.info({ sessionId: session.id, telegramChatId: telegramChatId.toString() }, 'session rotated');
  return session.id;
}

/**
 * Idle TTL job — expires sessions that have had no activity for longer than
 * the configured threshold. Designed to be called on a recurring schedule
 * (e.g., every 15 minutes).
 *
 * The next message from the user will automatically create a fresh session.
 */
export async function expireIdleSessions(idleThresholdHours: number): Promise<number> {
  const cutoff = new Date(Date.now() - idleThresholdHours * 60 * 60 * 1000);

  // Load all active sessions and check their last activity in application code.
  // Avoids provider-specific SQL (INTERVAL, quoted identifiers) for SQLite compatibility.
  const activeSessions = await prisma.chatSession.findMany({
    where: { endedAt: null },
    select: {
      id: true,
      createdAt: true,
      contextItems: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  const idleIds = activeSessions
    .filter(s => {
      const lastActivity = s.contextItems[0]?.createdAt ?? s.createdAt;
      return lastActivity < cutoff;
    })
    .map(s => s.id);

  if (idleIds.length === 0) return 0;

  const { count } = await prisma.chatSession.updateMany({
    where: { id: { in: idleIds } },
    data: { endedAt: new Date() },
  });

  log.info({ count, idleThresholdHours }, 'idle sessions expired');
  return count;
}
