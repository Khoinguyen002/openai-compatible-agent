import { createLogger } from "@workspace/core";
import path from "node:path";

// CWD is apps/telegram-bot/ when running via pnpm --filter
export const logger = createLogger(
  "telegram-bot",
  path.resolve(process.cwd(), "logs"),
);

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
