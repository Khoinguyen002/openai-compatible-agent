import http from "http";
import { config } from "./config/index.js";
import { logger } from "./modules/logger/index.js";
import { initSentry } from "./modules/sentry/index.js";
import { bot, createWebhookHandler } from "./modules/bot/index.js";
import { resetDailyRequestCounts } from "./modules/gateway/rateLimit.js";
import { expireIdleSessions } from "./modules/llm/orchestrator/session.js";
import { prisma } from "./db/client.js";

async function main() {
  initSentry();

  // Initialize workspace dirs
  try {
    const { initWorkspace } =
      await import("./modules/llm/tools/implementations/fsTools.js");
    await initWorkspace();
  } catch (err) {
    logger.warn({ err }, "workspace init skipped or failed");
  }

  // Ensure memory data directory exists
  try {
    const { mkdir } = await import("node:fs/promises");
    const { MEMORY_DATA_DIR } = await import("./config/workspace-dirs.js");
    await mkdir(MEMORY_DATA_DIR, { recursive: true });
  } catch (err) {
    logger.warn({ err }, "memory data dir init skipped or failed");
  }

  logger.info(
    { env: config.NODE_ENV, model: config.MODEL_ID },
    "agent starting",
  );

  // --- Schedule recurring jobs ---
  scheduleJobs();

  if (config.NODE_ENV === "production" && config.TELEGRAM_WEBHOOK_URL) {
    await startWebhookServer();
  } else {
    await bot.start({
      onStart: (info) =>
        logger.info(
          { username: info.username, mode: "long-polling", env: config.NODE_ENV, model: config.MODEL_ID },
          "bot ready",
        ),
    });
  }
}

async function startWebhookServer() {
  const webhookUrl = `${config.TELEGRAM_WEBHOOK_URL}/webhook`;

  // Register the webhook with Telegram
  await bot.api.setWebhook(webhookUrl, {
    secret_token: config.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
  });
  logger.info({ webhookUrl }, "webhook registered");

  const handler = createWebhookHandler();
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/webhook") {
      // Collect body for grammY
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        try {
          (req as typeof req & { body: unknown }).body = JSON.parse(
            Buffer.concat(chunks).toString("utf8") || "{}",
          );
        } catch {
          res.writeHead(400).end("Bad Request");
          return;
        }
        handler(req as never, res as never);
      });
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
      return;
    }

    res.writeHead(404).end();
  });

  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "webhook server listening");
  });
}

function scheduleJobs() {
  // Reset daily request counts at midnight UTC
  const msUntilMidnight = () => {
    const now = new Date();
    const midnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    return midnight.getTime() - now.getTime();
  };

  const scheduleMidnightReset = () => {
    setTimeout(async () => {
      try {
        await resetDailyRequestCounts();
      } catch (err) {
        logger.error({ err }, "daily reset job failed");
      }
      scheduleMidnightReset(); // reschedule for next midnight
    }, msUntilMidnight());
  };
  scheduleMidnightReset();

  // Expire idle sessions every 15 minutes
  setInterval(
    async () => {
      try {
        await expireIdleSessions(config.IDLE_TIMEOUT_HOURS);
      } catch (err) {
        logger.error({ err }, "idle session expiry job failed");
      }
    },
    15 * 60 * 1000,
  );

  logger.trace("background jobs scheduled");
}

// --- Graceful shutdown ---
async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  await bot.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception — exiting");
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err }, "fatal startup error");
  process.exit(1);
});
