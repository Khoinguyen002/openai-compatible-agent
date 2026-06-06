import type { User as TelegramUser } from 'grammy/types';
import { prisma } from "../db/client.js";

/**
 * Upserts a Telegram user into the DB.
 * New users are created with isWhitelisted = false (default).
 * Existing users have their username/firstName refreshed on each message.
 */
export async function syncUser(tgUser: TelegramUser): Promise<void> {
  await prisma.user.upsert({
    where: { id: BigInt(tgUser.id) },
    create: {
      id: BigInt(tgUser.id),
      username: tgUser.username ?? null,
      firstName: tgUser.first_name,
      isWhitelisted: false,
    },
    update: {
      username: tgUser.username ?? null,
      firstName: tgUser.first_name,
    },
  });
}
