import { readFileSync } from "fs";
import { join } from "path";

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
// Detailed guides (extensions.md, etc.) are lazy-loaded by the agent on demand via read_file.
const SOUL = readGuide("soul.md");
const GUIDE_INDEX = readGuide("index.md");

const BASE_SYSTEM_PROMPT = `\
${SOUL}

---

${GUIDE_INDEX}`;

export function getChatPrompt(): string {
  return (
    `${BASE_SYSTEM_PROMPT}\n\n` +
    "You are confined to the `workspace` directory.\n"
  );
}

export function getCronPrompt(): string {
  return (
    `${BASE_SYSTEM_PROMPT}\n\n` +
    "CRITICAL RULES FOR CRON CONTEXT:\n" +
    "- You are running automatically on a schedule. NEVER create, modify, or delete extensions (tools or crons) — register_tool, register_cron, and delete_extension are completely disabled in this context.\n" +
    "- The user message below is the pre-configured task prompt; treat it as instructions to execute, NOT as a user requesting new scheduled jobs.\n" +
    "- Focus solely on completing the scheduled task. You may use any available tools (search, read files, etc.) to gather information.\n" +
    "- TELEGRAM NOTIFICATION RULE: If your final goal is to report back to the user, you MUST explicitly call the `send_telegram_message` tool. Writing plain text or JSON as your normal response does NOT send anything to Telegram."
  );
}
