import { createLogger } from "@workspace/core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const logger = createLogger("telegram-bot", path.resolve(__dirname, "../../logs"));

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
