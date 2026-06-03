import { z } from "zod";
import dotenv from "dotenv";

process.env.TZ = "Asia/Ho_Chi_Minh";
dotenv.config();

const schema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_BOT_CHAT_ID: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional(),

  // OpenRouter
  OPENROUTER_API_KEY: z.string().min(1),

  // Database — accepts SQLite file paths (file:./dev.db) or standard URLs
  DATABASE_URL: z.string().min(1),

  // Agent behavior
  MODEL_ID: z.string().default("deepseek/deepseek-r1"),
  MODEL_CONTEXT_WINDOW_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(128_000),
  MAX_TOOL_ROUNDS: z.coerce.number().int().positive().default(10),

  // Rate limiting
  MAX_DAILY_REQUESTS_PER_USER: z.coerce.number().int().positive().default(100),
  MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().nonnegative().default(3000),

  // Session lifecycle
  IDLE_TIMEOUT_HOURS: z.coerce.number().positive().default(24),

  // Observability
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error"])
    .default("info"),
  SENTRY_DSN: z.string().optional(),

  // Runtime
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  // File system tooling
  WORKSPACE_DIR: z.string().default("workspace"),
  FS_MAX_FILE_BYTES: z.coerce.number().int().positive().optional(),
});

function loadConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${missing}`);
  }
  return result.data;
}

export const config = loadConfig();
export type Config = typeof config;
