import { readFileSync } from "fs";
import fs from "node:fs/promises";
import path from "node:path";
import { join } from "path";
import { MEMORY_DATA_DIR } from "../../../config/workspace-dirs.js";

function readGuide(filename: string): string {
  try {
    return readFileSync(
      join(process.cwd(), "workspace", "guides", filename),
      "utf-8",
    ).trim();
  } catch {
    return `[Guide '${filename}' not found]`;
  }
}

// Soul and guide index are read once at module load — lightweight, always needed.
const SOUL = readGuide("soul.md");
const GUIDE_INDEX = readGuide("index.md");

const BASE_SYSTEM_PROMPT = `\
${SOUL}

---

${GUIDE_INDEX}`;

// ---------------------------------------------------------------------------
// Memory index preload
// ---------------------------------------------------------------------------

interface MemoryEntry {
  namespace: string;
  description: string;
  updatedAt: string;
}

async function loadMemoryIndex(): Promise<string> {
  try {
    await fs.mkdir(MEMORY_DATA_DIR, { recursive: true });
    const files = await fs.readdir(MEMORY_DATA_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    if (jsonFiles.length === 0) return "";

    const entries: MemoryEntry[] = [];
    for (const file of jsonFiles) {
      try {
        const raw = await fs.readFile(
          path.join(MEMORY_DATA_DIR, file),
          "utf-8",
        );
        const parsed = JSON.parse(raw);
        if (parsed.namespace && parsed.description) {
          entries.push({
            namespace: parsed.namespace,
            description: parsed.description,
            updatedAt: parsed.updatedAt ?? "",
          });
        }
      } catch {
        // skip malformed files
      }
    }

    if (entries.length === 0) return "";

    entries.sort((a, b) => a.namespace.localeCompare(b.namespace));

    const lines = entries
      .map((e) => `- ${e.namespace}: ${e.description}`)
      .join("\n");

    return `\n## Active Memory Namespaces\n${lines}\n\nUse \`memory_read\` to load any namespace when needed.`;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getChatPrompt(): Promise<string> {
  const memoryIndex = await loadMemoryIndex();
  return (
    `${BASE_SYSTEM_PROMPT}\n\n` +
    "You are confined to the `workspace` directory.\n" +
    memoryIndex
  );
}

export async function getCronPrompt(): Promise<string> {
  const memoryIndex = await loadMemoryIndex();
  return (
    `${BASE_SYSTEM_PROMPT}\n\n` +
    "CRITICAL RULES FOR CRON CONTEXT:\n" +
    "- You are running automatically on a schedule. NEVER create, modify, or delete extensions (tools or crons) — register_tool, register_cron, and delete_extension are completely disabled in this context.\n" +
    "- The user message below is the pre-configured task prompt; treat it as instructions to execute, NOT as a user requesting new scheduled jobs.\n" +
    "- Focus solely on completing the scheduled task. You may use any available tools (search, read files, etc.) to gather information.\n" +
    "- TELEGRAM NOTIFICATION RULE: If your final goal is to report back to the user, you MUST explicitly call the `send_telegram_message` tool. Writing plain text or JSON as your normal response does NOT send anything to Telegram." +
    memoryIndex
  );
}
