import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/index.js";

const LOG_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "agent.log");

fs.mkdirSync(LOG_DIR, { recursive: true });

const targets: pino.TransportTargetOptions[] = [
  // File with size-based rotation — 100MB max, keep last 5 files
  {
    target: "pino-roll",
    level: config.LOG_LEVEL,
    options: {
      file: LOG_FILE,
      size: "100m",
      limit: { count: 5 },
    },
  },
];

if (config.NODE_ENV !== "production") {
  targets.push({
    target: "pino-pretty",
    level: config.LOG_LEVEL,
    options: { colorize: true, translateTime: "SYS:standard" },
  });
}

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    base: { service: "telegram-agent" },
  },
  pino.transport({ targets }),
);

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
