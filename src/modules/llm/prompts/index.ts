const BASE_SYSTEM_PROMPT = 
  "You are an AI Agent strictly locked inside the 'workspace' directory. You are forbidden to access or modify anything outside of it.\n" +
  "Read 'guides/soul.md' to understand your persona.";

export function getChatPrompt(): string {
  return (
    `${BASE_SYSTEM_PROMPT}\n\n` +
    "Core rules:\n" +
    "When (and ONLY when) creating, modifying, or managing system extensions (tools, crons, etc.), you MUST first read 'guides/extensions.md' and strictly use the designated extension management tools."
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
