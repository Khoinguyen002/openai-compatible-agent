import { prisma } from "@workspace/db";
import { config } from "@workspace/core";
import { childLogger } from "@workspace/core";

const log = childLogger({ module: "rateLimit" });

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Checks and updates per-user rate limits.
 * - Rejects if user is not whitelisted
 * - Rejects if daily request cap is reached
 * - Rejects if minimum request interval has not elapsed
 * Updates lastRequestAt and increments requestCountToday on success.
 */
export async function checkRateLimit(userId: bigint): Promise<RateLimitResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) return { allowed: false, reason: "User not found." };
  // if (!user.isWhitelisted)
  //   return {
  //     allowed: false,
  //     reason: "You are not authorized to use this bot.",
  //   };

  const now = new Date();

  if (user.lastRequestAt) {
    const elapsed = now.getTime() - user.lastRequestAt.getTime();
    if (elapsed < config.MIN_REQUEST_INTERVAL_MS) {
      log.warn({ userId: userId.toString() }, "rate limit: too soon");
      return {
        allowed: false,
        reason: `Please wait ${Math.ceil((config.MIN_REQUEST_INTERVAL_MS - elapsed) / 1000)}s before sending another message.`,
      };
    }
  }

  if (user.requestCountToday >= config.MAX_DAILY_REQUESTS_PER_USER) {
    log.warn({ userId: userId.toString() }, "rate limit: daily cap reached");
    return {
      allowed: false,
      reason: "Daily request limit reached. Try again tomorrow.",
    };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      lastRequestAt: now,
      requestCountToday: { increment: 1 },
    },
  });

  return { allowed: true };
}

/**
 * Resets requestCountToday for all users — run once daily at midnight UTC.
 */
export async function resetDailyRequestCounts(): Promise<void> {
  const { count } = await prisma.user.updateMany({
    data: { requestCountToday: 0 },
  });
  log.info({ count }, "daily request counts reset");
}
