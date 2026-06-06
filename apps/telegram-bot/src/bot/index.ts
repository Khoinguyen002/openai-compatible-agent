import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import { randomUUID } from "crypto";
import { config } from "@workspace/core";
import { childLogger } from "@workspace/core";
import { captureException } from "@workspace/core";
import { verifyWebhookSecret } from "../gateway/verification.js";
import { checkRateLimit } from "../gateway/rateLimit.js";
import { syncUser } from "../gateway/userSync.js";
import { sessionQueue } from "../queue/sessionQueue.js";
import {
  resolveOrCreateSession,
  rotateSession,
} from "@workspace/llm-engine";
import { orchestrate } from "@workspace/llm-engine";
import { prisma } from "@workspace/db";

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
    options?: { parse_mode?: "Markdown" | "HTML"; reply_markup?: InlineKeyboard },
  ) => Promise<unknown>;
};

function sanitizeTelegramHtml(text: string): string {
  const supportedTags = [
    'b', 'strong', 'i', 'em', 'code', 's', 'strike', 'del', 'u', 'pre', 
    'a', 'span', 'tg-spoiler', 'tg-emoji', 'blockquote'
  ];
  
  const validTags: string[] = [];
  let sanitized = text.replace(/<\/?([a-zA-Z0-9-]+)[^>]*>/g, (match, tagName) => {
    if (supportedTags.includes(tagName.toLowerCase())) {
      validTags.push(match);
      return `__VALID_TAG_${validTags.length - 1}__`;
    }
    return match;
  });

  sanitized = sanitized.replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
    await ctx
      .reply(safeHtml, { parse_mode: "HTML" })
      .catch((e) => {
        log.error({ err: e }, "Failed to send HTML formatted message, falling back to plain text");
        return ctx.reply(normalizedMessage);
      });
    return;
  }

  const chunks = chunkText(normalizedMessage, TELEGRAM_MESSAGE_LIMIT);

  for (const chunk of chunks) {
    const safeHtml = sanitizeTelegramHtml(chunk);
    await ctx.reply(safeHtml, { parse_mode: "HTML" }).catch(() => ctx.reply(chunk));
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

// --- /prj_create command ---
bot.command("prj_create", async (ctx) => {
  if (!ctx.from) return;
  const userId = BigInt(ctx.from.id);
  const match = ctx.message?.text?.match(/^\/prj_create\s+(.+)$/);
  if (!match) {
    return ctx.reply("Usage: /prj_create <title> | <description>");
  }

  const [title, ...descParts] = match[1].split("|").map(s => s.trim());
  const description = descParts.join("|") || null;

  if (!title) {
    return ctx.reply("Title is required.");
  }

  await syncUser(ctx.from);
  const project = await prisma.project.create({
    data: {
      userId,
      title,
      description,
    }
  });

  await ctx.reply(`✅ Project created: <b>${project.title}</b>\nID: <code>${project.id}</code>\nUse <code>/prj_join ${project.id}</code> to join.`, { parse_mode: "HTML" });
});

// --- /prj_list command ---
bot.command("prj_list", async (ctx) => {
  if (!ctx.from) return;
  const userId = BigInt(ctx.from.id);
  
  const projects = await prisma.project.findMany({
    where: { userId }
  });

  if (projects.length === 0) {
    return ctx.reply("You don't have any projects yet.");
  }

  const list = projects.map(p => `🔹 <b>${p.title}</b>\nID: <code>${p.id}</code>\nDesc: ${p.description || "N/A"}`).join("\n\n");
  await ctx.reply(`<b>Your Projects:</b>\n\n${list}`, { parse_mode: "HTML" });
});

// --- /prj_join command ---
bot.command("prj_join", async (ctx) => {
  if (!ctx.from) return;
  const userId = BigInt(ctx.from.id);
  const chatId = BigInt(ctx.chat.id);
  const match = ctx.message?.text?.match(/^\/prj_join\s+(.+)$/);
  
  if (!match) {
    return ctx.reply("Usage: /prj_join <project_id>");
  }
  const projectId = match[1].trim();

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId }
  });

  if (!project) {
    return ctx.reply("Project not found or you don't have access to it.");
  }

  const sessionId = await resolveOrCreateSession(chatId, userId);
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { projectId }
  });

  await ctx.reply(`✅ Joined project: <b>${project.title}</b>`, { parse_mode: "HTML" });
});

// --- /prj_status command ---
bot.command("prj_status", async (ctx) => {
  if (!ctx.from) return;
  const userId = BigInt(ctx.from.id);
  const chatId = BigInt(ctx.chat.id);

  const sessionId = await resolveOrCreateSession(chatId, userId);
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: { project: true }
  });

  if (session?.project) {
    let msg = `🔍 You are currently in project: <b>${session.project.title}</b>\n<i>${session.project.description || "No description"}</i>`;
    if (session.project.driveFolderId) {
      msg += `\n📁 Linked Drive Folder: <code>${session.project.driveFolderId}</code>`;
    }
    msg += `\n\nUse /prj_out to leave.`;
    await ctx.reply(msg, { parse_mode: "HTML" });
  } else {
    await ctx.reply("You are not currently in any project. You are in general chat. Use /prj_list to see available projects.");
  }
});

// --- /prj_set_drive command ---
bot.command("prj_set_drive", async (ctx) => {
  if (!ctx.from) return;
  const userId = BigInt(ctx.from.id);
  const chatId = BigInt(ctx.chat.id);
  const match = ctx.message?.text?.match(/^\/prj_set_drive\s+(.+)$/);
  
  if (!match) {
    return ctx.reply("Usage: /prj_set_drive <google_drive_folder_id>");
  }
  const folderId = match[1].trim();

  const sessionId = await resolveOrCreateSession(chatId, userId);
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId }
  });

  if (!session?.projectId) {
    return ctx.reply("You must join a project first before setting a Drive folder.");
  }

  await prisma.project.update({
    where: { id: session.projectId },
    data: { driveFolderId: folderId }
  });

  await ctx.reply(`✅ Google Drive folder linked to project successfully.\nFolder ID: <code>${folderId}</code>`, { parse_mode: "HTML" });
});

// --- /prj_out command ---
bot.command("prj_out", async (ctx) => {
  if (!ctx.from) return;
  const userId = BigInt(ctx.from.id);
  const chatId = BigInt(ctx.chat.id);

  const sessionId = await resolveOrCreateSession(chatId, userId);
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { projectId: null }
  });

  await ctx.reply(`🚪 Left the project. You are back to general chat.`);
});

// --- Main message handler with buffering ---
const messageBuffers = new Map<bigint, {
  text: string[];
  timer: NodeJS.Timeout;
}>();

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
    messageBuffers.set(userId, { text: [text], timer: setTimeout(() => {}, 0) });
  }

  const buffer = messageBuffers.get(userId)!;
  buffer.timer = setTimeout(async () => {
    messageBuffers.delete(userId);
    const fullText = buffer.text.join("\n\n");
    await processUserMessage(ctx, userId, chatId, fullText);
  }, 1000); // Wait 1 second for any remaining chunks
});

async function processUserMessage(ctx: any, userId: bigint, chatId: bigint, text: string) {
  const requestId = randomUUID();
  const reqLog = log.child({ requestId });

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

  // Show typing indicator (best-effort, non-blocking)
  ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => undefined);

  // Resolve or create session
  const sessionId = await resolveOrCreateSession(chatId, userId);

  sessionQueue.enqueue(sessionId, async () => {
    try {
      const typingInterval = setInterval(() => {
        ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => undefined);
      }, 4_000);

      try {
        const session = await prisma.chatSession.findUnique({
          where: { id: sessionId },
          include: { project: true }
        });

        if (session?.project?.driveFolderId) {
          const { syncProjectDriveFiles } = await import("@workspace/doc-agent");
          await syncProjectDriveFiles(session.projectId!, (msg: string) => {
            ctx.reply(msg).catch(() => undefined);
          });
        }

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
        const batchNeedsApproval = choice.tool_calls.some((tc: any) => tc.requiresApproval);
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
