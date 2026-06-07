import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import { randomUUID } from "crypto";
import { config } from "../config/index.js";
import { childLogger } from "../logger.js";
import { captureException } from "@workspace/core";
import { verifyWebhookSecret } from "../gateway/verification.js";
import { checkRateLimit } from "../gateway/rateLimit.js";
import { syncUser } from "../gateway/userSync.js";
import { sessionQueue } from "../queue/sessionQueue.js";
import {
  resolveOrCreateSession,
  rotateSession,
} from "../orchestrator/session.js";
import { orchestrate } from "../orchestrator/index.js";
import { prisma } from "../db/client.js";

const log = childLogger({ module: "bot" });
const TELEGRAM_MESSAGE_LIMIT = 4096;

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

function chunkText(text: string, limit: number) {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + limit, text.length);

    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > start) {
        end = newline + 1;
      }
    }

    chunks.push(text.slice(start, end).trimEnd());
    start = end;
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

type ReplyContext = {
  reply: (
    text: string,
    options?: {
      parse_mode?: "Markdown" | "HTML";
      reply_markup?: InlineKeyboard;
    },
  ) => Promise<unknown>;
};

function sanitizeTelegramHtml(text: string): string {
  const supportedTags = [
    "b",
    "strong",
    "i",
    "em",
    "code",
    "s",
    "strike",
    "del",
    "u",
    "pre",
    "a",
    "span",
    "tg-spoiler",
    "tg-emoji",
    "blockquote",
  ];

  const validTags: string[] = [];
  let sanitized = text.replace(
    /<\/?([a-zA-Z0-9-]+)[^>]*>/g,
    (match, tagName) => {
      if (supportedTags.includes(tagName.toLowerCase())) {
        validTags.push(match);
        return `__VALID_TAG_${validTags.length - 1}__`;
      }
      return match;
    },
  );

  sanitized = sanitized.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  sanitized = sanitized.replace(/__VALID_TAG_(\d+)__/g, (match, index) => {
    return validTags[parseInt(index)];
  });

  return sanitized;
}

async function replyWithChunking(ctx: ReplyContext, message: string) {
  const normalizedMessage = message.trim();

  if (!normalizedMessage) {
    return;
  }

  if (normalizedMessage.length <= TELEGRAM_MESSAGE_LIMIT) {
    const safeHtml = sanitizeTelegramHtml(normalizedMessage);
    await ctx.reply(safeHtml, { parse_mode: "HTML" }).catch((e) => {
      log.error(
        { err: e },
        "Failed to send HTML formatted message, falling back to plain text",
      );
      return ctx.reply(normalizedMessage);
    });
    return;
  }

  const chunks = chunkText(normalizedMessage, TELEGRAM_MESSAGE_LIMIT);

  for (const chunk of chunks) {
    const safeHtml = sanitizeTelegramHtml(chunk);
    await ctx
      .reply(safeHtml, { parse_mode: "HTML" })
      .catch(() => ctx.reply(chunk));
  }
}

// --- /start command ---
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Hello! I am your AI assistant.\n\n" +
      "Send me any message to start a conversation.\n" +
      "Use /newchat to start a fresh session.",
  );
});

// --- /newchat command ---
bot.command("newchat", async (ctx) => {
  if (!ctx.from) return;
  const userId = BigInt(ctx.from.id);
  const chatId = BigInt(ctx.chat.id);

  await syncUser(ctx.from);
  await rotateSession(chatId, userId);
  await ctx.reply(
    "New conversation started. Your previous context has been cleared.",
  );
});

// --- Main message handler with buffering ---
const messageBuffers = new Map<
  bigint,
  {
    text: string[];
    timer: NodeJS.Timeout;
  }
>();

bot.on("message", async (ctx, next) => {
  log.info({ update: ctx.update }, "received raw message update");
  await next();
});

bot.on("message:text", async (ctx) => {
  if (!ctx.from) return;

  const userId = BigInt(ctx.from.id);
  const chatId = BigInt(ctx.chat.id);
  const text = ctx.message.text.trim();

  if (!text) return;

  const existingBuffer = messageBuffers.get(userId);
  if (existingBuffer) {
    clearTimeout(existingBuffer.timer);
    existingBuffer.text.push(text);
  } else {
    messageBuffers.set(userId, {
      text: [text],
      timer: setTimeout(() => {}, 0),
    });
  }

  const buffer = messageBuffers.get(userId)!;
  buffer.timer = setTimeout(async () => {
    messageBuffers.delete(userId);
    const fullText = buffer.text.join("\n\n");
    await processUserMessage(ctx, userId, chatId, fullText);
  }, 1000); // Wait 1 second for any remaining chunks
});

async function processUserMessage(
  ctx: any,
  userId: bigint,
  chatId: bigint,
  text: string,
) {
  const requestId = randomUUID();
  const reqLog = log.child({ requestId });

  // Show typing indicator (best-effort, non-blocking)
  ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => undefined);

  reqLog.info(
    {
      userId: userId.toString(),
      chatId: chatId.toString(),
      preview: text.slice(0, 60),
    },
    "message received",
  );

  // Sync user profile
  await syncUser(ctx.from);

  // Rate limit check
  const rateResult = await checkRateLimit(userId);
  if (!rateResult.allowed) {
    await ctx.reply(rateResult.reason);
    return;
  }

  // Resolve or create session
  const sessionId = await resolveOrCreateSession(chatId, userId);

  sessionQueue.enqueue(sessionId, async () => {
    try {
      const typingInterval = setInterval(() => {
        ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => undefined);
      }, 4_000);

      try {
        await orchestrate({
          sessionId,
          userMessage: text,
          senderUserId: userId,
          requestId,
          ...getOrchestrateEvents(ctx as unknown as ReplyContext, sessionId),
        });
      } finally {
        clearInterval(typingInterval);
      }
    } catch (err: any) {
      if (
        err.message &&
        err.message.includes("Please press Approve or Reject")
      ) {
        await ctx.reply(err.message).catch(() => undefined);
        return;
      }
      reqLog.error({ err }, "agent job failed");
      captureException(err, {
        sessionId,
        requestId,
        userId: userId.toString(),
      });
      await ctx
        .reply(
          "Sorry, something went wrong while processing your request. Please try again.",
        )
        .catch(() => undefined);
    }
  });
}

function getOrchestrateEvents(ctx: ReplyContext, sessionId: string) {
  return {
    async onChoice(choice: any) {
      if (choice.content) {
        await replyWithChunking(ctx, choice.content);
      }
      if (choice.tool_calls) {
        const batchNeedsApproval = choice.tool_calls.some(
          (tc: any) => tc.requiresApproval,
        );
        // If ANY tool in the batch needs approval, skip all "Calling tool" messages.
        // The approval alert will show the full batch so user knows what will execute.
        if (!batchNeedsApproval) {
          for (const toolCall of choice.tool_calls) {
            await replyWithChunking(ctx, `⚡ \`${toolCall.function.name}\``);
          }
        }
      }
    },
    async onApprovalRequest(tools: any[]) {
      const keyboard = new InlineKeyboard()
        .text("✅ Approve", `approve_${sessionId}`)
        .text("❌ Reject", `reject_${sessionId}`);

      const toolDetails = tools
        .map((t: any) => {
          const args = t.function.arguments;
          let parsedArgs: string;
          try {
            const obj = typeof args === "string" ? JSON.parse(args) : args;
            parsedArgs = JSON.stringify(obj, null, 2);
          } catch {
            parsedArgs = String(args);
          }
          const badge = t.requiresApproval ? "🔒" : "⚡";
          return `${badge} \`${t.function.name}\`\n\`\`\`json\n${parsedArgs}\n\`\`\``;
        })
        .join("\n\n");

      await ctx.reply(
        `⚠️ *Security Alert*\n\nThe AI agent is requesting to execute:\n\n${toolDetails}\n\n🔒 = requires approval  ⚡ = runs alongside\n\nDo you want to approve this action?`,
        { reply_markup: keyboard, parse_mode: "Markdown" },
      );
    },
  };
}

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!data.startsWith("approve_") && !data.startsWith("reject_")) {
    return;
  }

  const isApprove = data.startsWith("approve_");
  const sessionId = data.split("_")[1];
  const action = isApprove ? "approve" : "reject";

  if (!ctx.from) return;
  const userId = BigInt(ctx.from.id);

  await ctx
    .editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } })
    .catch(() => {});

  await ctx.reply(
    isApprove
      ? "✅ Approved! Executing the requested tools..."
      : "❌ Tool execution rejected.",
  );

  sessionQueue.enqueue(sessionId, async () => {
    try {
      const typingInterval = setInterval(() => {
        if (ctx.chat) {
          ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => undefined);
        }
      }, 4_000);

      try {
        await orchestrate({
          sessionId,
          userMessage: "",
          senderUserId: userId,
          requestId: randomUUID(),
          resumeAction: action,
          ...getOrchestrateEvents(ctx as unknown as ReplyContext, sessionId),
        });
      } finally {
        clearInterval(typingInterval);
      }
    } catch (err) {
      log.error({ err }, "agent resume job failed");
      captureException(err, {
        sessionId,
        userId: userId.toString(),
      });
      await ctx
        .reply("Sorry, something went wrong while resuming.")
        .catch(() => undefined);
    }
  });

  await ctx.answerCallbackQuery().catch(() => undefined);
});

/**
 * Returns an Express-compatible webhook handler with secret verification.
 * The 200 ACK is sent immediately by grammY before the bot processes the update,
 * satisfying Telegram's 5-second timeout requirement.
 */
export function createWebhookHandler() {
  return async (
    req: import("http").IncomingMessage & { body?: unknown },
    res: import("http").ServerResponse,
  ) => {
    const secret =
      (req.headers["x-telegram-bot-api-secret-token"] as string) || "";

    if (!verifyWebhookSecret(secret)) {
      log.warn(
        { ip: req.socket.remoteAddress },
        "webhook: invalid secret token — rejected",
      );
      res.writeHead(401).end("Unauthorized");
      return;
    }

    return webhookCallback(bot, "http")(req as never, res as never);
  };
}
