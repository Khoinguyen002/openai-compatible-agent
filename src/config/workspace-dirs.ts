import path from "node:path";
import { config } from "./index.js";

export const BASE_WORKSPACE = path.resolve(process.cwd(), config.WORKSPACE_DIR);

export const TOOL_DECLARATION = path.resolve(
  BASE_WORKSPACE,
  "tools/declaration.json",
);
export const CRON_DECLARATION = path.resolve(
  BASE_WORKSPACE,
  "cron/declaration.json",
);
