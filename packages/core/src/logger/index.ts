import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/index.js";

export function createLogger(appName: string, logDirPath?: string) {
  const finalLogDir = logDirPath || path.resolve(process.cwd(), "logs");
  const logFile = path.join(finalLogDir, `${appName}.log`);

  fs.mkdirSync(finalLogDir, { recursive: true });

  const targets: pino.TransportTargetOptions[] = [
    {
      target: "pino-roll",
      level: config.LOG_LEVEL || "info",
      options: {
        file: logFile,
        size: "100m",
        limit: { count: 5 },
      },
    },
  ];

  if (config.NODE_ENV !== "production") {
    targets.push({
      target: "pino-pretty",
      level: config.LOG_LEVEL || "info",
      options: { colorize: true, translateTime: "SYS:standard" },
    });
  }

  return pino(
    {
      level: config.LOG_LEVEL || "info",
      base: { app: appName },
    },
    pino.transport({ targets }),
  );
}

// Global default logger for core/generic usage
export const logger = createLogger("agent");

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
