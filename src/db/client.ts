import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { logger } from "../modules/logger/index.js";

const dbUrl = process.env.DATABASE_URL || "file:src/db/dev.db";
// PrismaBetterSqlite3 accepts file: prefixed paths directly
const adapter = new PrismaBetterSqlite3({ url: dbUrl });

const prisma = new PrismaClient({
  adapter,
  log: [
    { level: "error", emit: "event" },
    { level: "warn", emit: "event" },
  ],
});

prisma.$on("error", (e) => logger.error({ target: e.target }, e.message));
prisma.$on("warn", (e) => logger.warn({ target: e.target }, e.message));

export { prisma };
