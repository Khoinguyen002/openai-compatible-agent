import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { join } from "node:path";
import fs from "node:fs";
import { config } from "@workspace/core";
import { childLogger } from "@workspace/core";

const log = childLogger({ module: "db" });

const dbPath = join(process.cwd(), "prisma", "dev.db");
const dbUrl = `file:${dbPath}`;

// Ensure directory exists
fs.mkdirSync(join(process.cwd(), "prisma"), { recursive: true });

log.info({ path: dbUrl }, "initializing database connection");

let prismaClient: PrismaClient;
try {
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  prismaClient = new PrismaClient({ adapter });
  
  log.info("database connection established");
} catch (error) {
  log.fatal({ err: error }, "failed to initialize database connection");
  throw error;
}

export const prisma = prismaClient;
