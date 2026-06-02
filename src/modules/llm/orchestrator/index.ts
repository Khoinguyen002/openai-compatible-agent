import {
  ChatMessages,
  fromChatMessages,
  Item,
  OpenRouter,
  tool,
} from "@openrouter/agent";

import z from "zod";
import { config } from "../../../config/index.js";
import { childLogger } from "../../logger/index.js";
import { captureException } from "../../sentry/index.js";
import { hydrateContext } from "./hydrate.js";
import { persistItems } from "./persistItems.js";
import {
  Message,
  NonStreamingChoice,
  Request,
  Response,
  ToolCall,
  ToolMessage,
} from "./type.js";
import { sendLLMRequest } from "./pure-llm.js";
import { toolImplementations } from "../tools/implementations/index.js";
import { getTools } from "../tools/index.js";
import { executeDynamicTool } from "../tools/helpers.js";

const log = childLogger({ module: "orchestrator" });

const openrouter = new OpenRouter({ apiKey: config.OPENROUTER_API_KEY });

export interface OrchestrateOptions {
  sessionId: string;
  userMessage: string;
  senderUserId: bigint;
  requestId: string;
}

export interface OrchestrateResult {
  reply: string;
  durationMs: number;
}

export async function orchestrate(
  opts: OrchestrateOptions,
): Promise<OrchestrateResult> {
  const { sessionId, userMessage, senderUserId, requestId } = opts;
  const reqLog = log.child({ sessionId, requestId });
  const start = Date.now();
  const tools = await getTools();

  reqLog.info({ preview: userMessage.slice(0, 80) }, "agent loop start");

  let choiceMessage: NonStreamingChoice["message"] | null = null;
  await persistItems(
    sessionId,
    senderUserId,
    [{ role: "user", content: userMessage }],
    reqLog,
  );

  try {
    while (true) {
      const history = await hydrateContext(sessionId);
      const fullHistory: Message[] = [
        {
          role: "system",
          content:
            "You are an AI Agent strictly locked inside the 'workspace' directory. You are forbidden to access or modify anything outside of it. Core rules:\n" +
            "1. Read 'guides/soul.md' to understand your persona.\n" +
            "2. When (and ONLY when) creating/modifying extensions (tools, crons, etc.), you MUST first read 'guides/extensions.md' and exclusively use 'register_tool', 'register_cron', or 'delete_extension'. Manual 'write_file' on registries is strictly blocked.",
        },
        ...history,
      ];

      const result = await sendLLMRequest({
        messages: fullHistory,
        model: config.MODEL_ID,
        tools,
      });

      choiceMessage = (result.choices[0] as NonStreamingChoice).message;
      await persistItems(sessionId, senderUserId, [choiceMessage], reqLog);

      const hasToolCalls =
        choiceMessage.tool_calls && choiceMessage.tool_calls.length > 0;

      if (!hasToolCalls) break;

      log.trace(
        { toolCalls: choiceMessage.tool_calls },
        "tool calls detected in response",
      );

      const toolResults = await Promise.all<ToolMessage>(
        (choiceMessage.tool_calls ?? []).map(async (tc) => {
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
              name: tc.function.name,
            };
          } catch (error) {
            log.error(
              { error, toolCall: tc },
              "Error occurred while executing tool call",
            );

            return {
              content: error instanceof Error ? error.message : String(error),
              role: "tool",
              tool_call_id: tc.id,
              name: tc.function.name,
            };
          }
        }),
      );

      log.trace({ toolResults }, "tool calls successfully executed");

      await persistItems(sessionId, senderUserId, toolResults, reqLog);

      log.trace("tool calls successfully persisted");
    }
  } catch (err) {
    reqLog.error({ err }, "OpenRouter call failed");
    captureException(err, { sessionId, requestId });
    throw err;
  }

  const durationMs = Date.now() - start;
  reqLog.info("agent loop complete");

  return { reply: choiceMessage.content ?? "", durationMs };
}
