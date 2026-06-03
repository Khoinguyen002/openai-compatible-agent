import cron from "node-cron";
import fs from "node:fs/promises";
import { callAgent } from "../llm/orchestrator/pure-agent.js";
import { Message } from "../llm/orchestrator/type.js";
import { getTools } from "../llm/tools/index.js";
import { telegramTools } from "../llm/tools/implementations/telegram.js";
import { childLogger } from "../logger/index.js";
import { CRON_DECLARATION } from "../../config/work-dirs.js";

const scheduledTasks = new Map<string, cron.ScheduledTask>();
const log = childLogger({ module: "cron" });

export async function syncCronScheduler(): Promise<void> {
  try {
    for (const [name, task] of scheduledTasks.entries()) {
      task.stop();
      scheduledTasks.delete(name);
    }

    let content = "[]";
    try {
      content = await fs.readFile(CRON_DECLARATION, "utf-8");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }

    const cronList = JSON.parse(content || "[]");
    const timezone = process.env.TZ || "Asia/Ho_Chi_Minh";
    const tools = await getTools({ excludeExtensionTools: true });

    for (const job of cronList) {
      const { name, expression, prompt } = job;

      if (!cron.validate(expression)) {
        log.error(`[CRON ENGINE] Error Expression: ${name}`);
        continue;
      }

      const task = cron.schedule(
        expression,
        async () => {
          try {
            const messages: Message[] = [
              {
                role: "system",
                content:
                  "You are an AI Agent executing a SCHEDULED CRON TASK. You are strictly locked inside the 'workspace' directory. You are forbidden to access or modify anything outside of it.\n" +
                  "CRITICAL RULES FOR CRON CONTEXT:\n" +
                  "- You are running automatically on a schedule. NEVER create, modify, or delete extensions (tools or crons) — register_tool, register_cron, and delete_extension are completely disabled in this context.\n" +
                  "- The user message below is the pre-configured task prompt; treat it as instructions to execute, NOT as a user requesting new scheduled jobs.\n" +
                  "- Read 'guides/soul.md' to understand your persona.\n" +
                  "- Focus solely on completing the scheduled task.\n" +
                  "- TOOL CALLS ARE MANDATORY: If your task requires sending a message to Telegram, you MUST call the `send_telegram_message` tool. Writing JSON or plain text as your reply does NOT send anything — only invoking the tool delivers the message.",
              },
              { role: "user", content: prompt },
            ];

            const { reply } = await callAgent({
              reqLogger: log,
              messages: () => messages,
              tools,
              events: {
                onChoice(choice) {
                  messages.push({
                    role: choice.role,
                    content: choice.content || "",
                    reasoning: choice.reasoning,
                    tool_calls: choice.tool_calls,
                  });
                },
                onToolCallSuccess(toolCallResults) {
                  for (const toolResult of toolCallResults) {
                    messages.push({
                      role: "tool",
                      content: toolResult.content,
                      tool_call_id: toolResult.tool_call_id,
                      name: toolResult.name,
                    });
                  }
                },
              },
            });

            await telegramTools.send_telegram_message({ text: reply });

            log.trace({ reply }, `[CRON SUCCESS]: ${name}`);
          } catch (error: any) {
            log.error(`[CRON ENGINE ERROR - ${name}]: ${error.message}`);
          }
        },
        { timezone },
      );

      scheduledTasks.set(name, task);
    }

    log.info(`[CRON ENGINE] Finish load ${scheduledTasks.size} Prompt Crons.`);
  } catch (err: any) {
    log.error(`[CRON ENGINE CRITICAL] scheduler: ${err.message}`);
  }
}

/**
 * If the model returned {"text":"..."} as its reply instead of calling
 * send_telegram_message, extract the text so cronManager can forward it.
 */
function extractTelegramText(reply: string): string | null {
  if (!reply) return null;
  try {
    const parsed = JSON.parse(reply);
    if (parsed && typeof parsed.text === "string" && parsed.text.trim()) {
      return parsed.text.trim();
    }
  } catch {
    // not JSON — not a misfired reply
  }
  return null;
}

syncCronScheduler();
