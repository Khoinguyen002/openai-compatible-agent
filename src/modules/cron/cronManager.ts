import cron from "node-cron";
import fs from "node:fs/promises";
import { callAgent } from "../llm/orchestrator/pure-agent.js";
import { Message } from "../llm/orchestrator/types/index.js";
import { childLogger } from "../logger/index.js";
import { CRON_DECLARATION } from "../../config/workspace-dirs.js";
import { getCronPrompt } from "../llm/prompts/index.js";

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
    const tools = await (
      await import("../llm/tools/index.js").then((mod) => mod.getTools)
    )({
      excludedNames: ["register_tool", "register_cron", "delete_extension"],
    });

    for (const job of cronList) {
      const { name, expression, prompt, active = true } = job;

      if (active === false) {
        log.info(`[CRON ENGINE] Skipping disabled cron: ${name}`);
        continue;
      }

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
                content: getCronPrompt(),
              },
              { role: "system", content: prompt },
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
                    });
                  }
                },
              },
            });

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
