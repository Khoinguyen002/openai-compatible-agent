import path from "node:path";

export const TOOL_DECLARATION = path.resolve(
  process.cwd(),
  "workspace/skills/tools/declaration.json",
);
export const CRON_DECLARATION = path.resolve(
  process.cwd(),
  "workspace/skills/cron/declaration.json",
);
export const MEMORY_DATA_DIR = path.resolve(
  process.cwd(),
  "workspace/skills/memory/data",
);
