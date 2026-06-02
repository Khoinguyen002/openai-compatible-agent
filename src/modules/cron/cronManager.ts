import cron from "node-cron";
import fs from "node:fs/promises";
import path from "node:path";
import { sendLLMRequest } from "../llm/orchestrator/pure-llm.js";
import { getTools } from "../llm/tools/index.js";
import { toolImplementations } from "../llm/tools/implementations/index.js";
import { executeDynamicTool } from "../llm/tools/helpers.js";
import { config } from "../../config/index.js";
import { NonStreamingChoice } from "../llm/orchestrator/type.js";

const BASE_WORKSPACE = path.resolve(process.cwd(), "workspace");
const CRON_DECLARATION = path.resolve(BASE_WORKSPACE, "cron/declaration.json");

const scheduledTasks = new Map<string, cron.ScheduledTask>();

/**
 * Đồng bộ bộ lên lịch Prompt Cron - CHẠY VÒNG LẶP TOOL CALL ĐỘC LẬP QUA sendLLMRequest
 */
export async function syncCronScheduler(): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("[CRON ENGINE] Thiếu TELEGRAM_BOT_TOKEN trong file .env!");
      return;
    }

    // 1. Clear sạch task cũ trong bộ nhớ để tránh chạy trùng loop khi hot-reload
    for (const [name, task] of scheduledTasks.entries()) {
      task.stop();
      scheduledTasks.delete(name);
    }

    // 2. Đọc file cấu hình JSON của Cron
    let content = "[]";
    try {
      content = await fs.readFile(CRON_DECLARATION, "utf-8");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }

    const cronList = JSON.parse(content || "[]");
    const timezone = process.env.APP_TIMEZONE || "Asia/Ho_Chi_Minh";

    // 3. Khởi tạo vòng lặp Cron
    for (const job of cronList) {
      const { name, expression, prompt, chatId } = job;

      if (!cron.validate(expression)) {
        console.error(`[CRON ENGINE] Expression lỗi bị bỏ qua: ${name}`);
        continue;
      }

      const task = cron.schedule(
        expression,
        async () => {
          console.log(
            `[CRON TICK] Khởi chạy Stateless Agent Loop cho task: ${name}`,
          );
          try {
            // Bốc đống tool mới nhất ra (để nếu AI có đăng ký thêm tool mới lúc runtime thì vẫn ăn luôn)
            const tools = await getTools();

            // Dựng mảng messages cô lập hoàn toàn cho lượt chạy này
            let messages: any[] = [
              {
                role: "system",
                content:
                  "You are an AI Agent strictly locked inside the 'workspace' directory. You are forbidden to access or modify anything outside of it. Core rules:\n" +
                  "1. Read 'guides/soul.md' to understand your persona.\n" +
                  "2. When (and ONLY when) creating/modifying extensions (tools, crons, etc.), you MUST first read 'guides/extensions.md' and exclusively use 'register_tool', 'register_cron', or 'delete_extension'. Manual 'write_file' on registries is strictly blocked.",
              },
              { role: "user", content: prompt },
            ];

            // 🚀 VÒNG LẶP ĐỆ QUY XỬ LÝ TOOL CALL
            while (true) {
              const result = await sendLLMRequest({
                messages,
                model: config.MODEL_ID,
                tools,
              });

              const choiceMessage = (result.choices[0] as NonStreamingChoice)
                .message;
              messages.push(choiceMessage);

              const hasToolCalls =
                choiceMessage.tool_calls && choiceMessage.tool_calls.length > 0;

              // Nếu con AI đéo thèm gọi tool nữa -> Vòng lặp kết thúc, lấy kết quả đi gửi Tele
              if (!hasToolCalls) break;

              console.log(
                `[CRON AGENT - ${name}] Phát hiện ${choiceMessage.tool_calls?.length} tool call từ LLM.`,
              );

              // Thực thi đống tool song song y hệt bên orchestrator của mày
              const toolResults = await Promise.all(
                (choiceMessage.tool_calls ?? []).map(async (tc: any) => {
                  try {
                    const toolName = tc.function.name;
                    const toolArgs = JSON.parse(tc.function.arguments);

                    let toolResult;
                    if (toolName in toolImplementations) {
                      const executeFn =
                        toolImplementations[
                          toolName as keyof typeof toolImplementations
                        ];
                      toolResult = await executeFn(toolArgs);
                    } else {
                      toolResult = await executeDynamicTool(toolName, toolArgs);
                    }

                    return {
                      content: JSON.stringify(toolResult),
                      role: "tool",
                      tool_call_id: tc.id,
                      name: toolName,
                    };
                  } catch (error) {
                    return {
                      content:
                        error instanceof Error ? error.message : String(error),
                      role: "tool",
                      tool_call_id: tc.id,
                      name: tc.function.name,
                    };
                  }
                }),
              );

              // Đút kết quả chạy tool vào lịch sử ngữ cảnh tạm thời rồi lặp tiếp
              messages.push(...toolResults);
            }

            // Lấy câu trả lời cuối cùng sau khi đã xài xong hết đống tool cần thiết
            const finalReply = messages[messages.length - 1]?.content;

            if (finalReply) {
              const response = await fetch(
                `https://api.telegram.org/bot${token}/sendMessage`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text: finalReply,
                    parse_mode: "Markdown",
                  }),
                },
              );

              if (!response.ok) {
                const errData = await response.json();
                console.error(
                  `[CRON TELEGRAM ERROR - ${name}]: ${errData?.description}`,
                );
              }
            }

            console.log(`[CRON SUCCESS] Đã hoàn thành tác vụ ngầm: ${name}`);
          } catch (error: any) {
            console.error(`[CRON ENGINE ERROR - ${name}]: ${error.message}`);
          }
        },
        { timezone },
      );

      scheduledTasks.set(name, task);
    }

    console.log(
      `[CRON ENGINE] Đã nạp thành công ${scheduledTasks.size} Prompt Crons chạy loop độc lập.`,
    );
  } catch (err: any) {
    console.error(
      `[CRON ENGINE CRITICAL] Toang bộ core scheduler: ${err.message}`,
    );
  }
}
