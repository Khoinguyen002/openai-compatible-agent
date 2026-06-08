import { createLogger } from "@workspace/core";
import { config } from "./config/index.js";
import path from "node:path";

// CWD is apps/telegram-bot/ when running via pnpm --filter
export const logger = createLogger({
  appName: "telegram-bot",
  logLevel: config.LOG_LEVEL,
  isProd: config.NODE_ENV === "production",
  logDirPath: path.resolve(process.cwd(), "logs"),
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
