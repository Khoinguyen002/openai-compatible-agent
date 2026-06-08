import pino from "pino";
import fs from "node:fs";
import path from "node:path";

export interface LoggerOptions {
  appName: string;
  logLevel?: string;
  isProd?: boolean;
  logDirPath?: string;
}

export function createLogger(options: LoggerOptions): pino.Logger {
  const { appName, logLevel = "info", isProd = false, logDirPath } = options;
  const finalLogDir = logDirPath || path.resolve(process.cwd(), "logs");
  const logFile = path.join(finalLogDir, `${appName}.log`);

  fs.mkdirSync(finalLogDir, { recursive: true });

  const targets: pino.TransportTargetOptions[] = [
    {
      target: "pino-roll",
      level: logLevel,
      options: {
        file: logFile,
        size: "100m",
        limit: { count: 5 },
      },
    },
  ];

  if (!isProd) {
    targets.push({
      target: "pino-pretty",
      level: logLevel,
      options: { colorize: true, translateTime: "SYS:standard" },
    });
  }

  return pino(
    {
      level: logLevel,
      base: { app: appName },
    },
    pino.transport({ targets }),
  );
}
