import cron from "node-cron";
import fs from "node:fs/promises";
import { callAgent } from "@workspace/llm-engine";
import { Message } from "@workspace/llm-engine";
import { childLogger } from "../logger.js";
import { CRON_DECLARATION } from "@workspace/core";
import { config } from "../config/index.js";
import { getCronPrompt } from "../prompts/index.js";
import { getTools, executeTool } from "../tools/index.js";
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
    const allTools = await getTools();
    const tools = allTools.filter(
      (t: any) =>
        !["register_tool", "register_cron", "delete_extension"].includes(
          t.function.name,
        ),
    );

    for (const job of cronList) {
      const {
        name,
        expression,
        systemPrompt,
        prompt,
        active = true,
      } = job;
      const actualPrompt = systemPrompt || prompt;

      if (active === false) {
        log.debug({ name }, "[cron] skipping disabled job");
        continue;
      }

      if (!cron.validate(expression)) {
        log.error(
          { name, expression },
          "[cron] invalid cron expression — skipping",
        );
        continue;
      }

      const task = cron.schedule(
        expression,
        async () => {
          try {
            const messages: Message[] = [
              {
                role: "system",
                content: await getCronPrompt(),
              },
              {
                role: "developer",
                content: "CRON TASK TO EXECUTE:\n" + actualPrompt,
              },
            ];

            const { reply } = await callAgent({
              reqLogger: log,
              messages: () => messages,
              tools,
              toolExecutors: executeTool,
              apiKey: config.OPENROUTER_API_KEY,
              modelId: config.MODEL_ID,
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

    const jobs = [...scheduledTasks.keys()];
    log.info(
      { count: scheduledTasks.size, ...(jobs.length > 0 && { jobs }) },
      "[cron] scheduler ready.",
    );
  } catch (err: any) {
    log.error({ err: err.message }, "[cron] critical scheduler error");
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
process.on("cron:sync", () => {
  log.info("[cron] sync event received");
  syncCronScheduler();
});
