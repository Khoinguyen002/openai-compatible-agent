import {
  ChatMessages,
  fromChatMessages,
  Item,
  OpenRouter,
  tool,
} from "@openrouter/agent";

import z from "zod";
import { config } from "../config/index.js";
import { childLogger } from "../logger.js";
import { captureException } from "../sentry.js";
import { hydrateContext } from "./hydrate.js";
import { persistItems } from "./persistItems.js";
import { extractReasoning } from "./reasoning.js";
import { wrapToolsForLogging, type PendingContextItem } from "./toolWrapper.js";
import { registeredTools } from "../tools/index.js";
import {
  Message,
  NonStreamingChoice,
  Request,
  Response,
  ToolCall,
  ToolMessage,
} from "./type.js";

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

const url = "https://openrouter.ai/api/v1/chat/completions";
const options = {
  method: "POST",
  headers: {
    "X-OpenRouter-Experimental-Metadata": "enabled",
    Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  },
};

export async function orchestrate(
  opts: OrchestrateOptions,
): Promise<OrchestrateResult> {
  const { sessionId, userMessage, senderUserId, requestId } = opts;
  const reqLog = log.child({ sessionId, requestId });
  const start = Date.now();

  reqLog.info({ preview: userMessage.slice(0, 80) }, "agent loop start");

  // Build message history — system prompt + prior context + new user message

  // Wrap tools to capture trajectory for DB persistence
  const turnLog: PendingContextItem[] = [];
  // const wrappedTools = wrapToolsForLogging([...registeredTools], turnLog);

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
        { role: "system", content: config.SYSTEM_PROMPT },
        ...history,
      ];

      const response = await fetch(url, {
        ...options,
        body: JSON.stringify({
          messages: fullHistory,
          model: config.MODEL_ID,
          tools: registeredTools,
        } satisfies Request),
      });

      const result = (await response.json()) as Response;
      // const result = openrouter.callModel({
      //   model: config.MODEL_ID,
      //   input: fromChatMessages(fullHistory) as Item[],
      //   tools: wrappedTools,
      //   // maxToolRounds: config.MAX_TOOL_ROUNDS,
      //   ...(config.REASONING_ENABLED ? { reasoning: { enabled: true } } : {}),
      // });

      // Non-streaming: blocks until all tool rounds complete
      // finalText = await result.getText();
      // rawResponse = await result.getResponse();

      choiceMessage = (result.choices[0] as NonStreamingChoice).message;
      await persistItems(sessionId, senderUserId, [choiceMessage], reqLog);

      if (choiceMessage.tool_calls && choiceMessage.tool_calls?.length > 0) {
        log.trace(
          { toolCalls: choiceMessage.tool_calls },
          "tool calls detected in response",
        );
        const toolResults = (
          await Promise.all(
            choiceMessage.tool_calls.map(async (tc) => {
              const tool = registeredTools.find(
                (t) => t.function.name === tc.function.name,
              );

              if (tool) {
                const args = JSON.parse(tc.function.arguments);
                const result = await tool.execute(args);
                return {
                  content: JSON.stringify(result),
                  role: "tool",
                  tool_call_id: tc.id,
                  name: tc.function.name,
                } as ToolMessage;
              } else {
                return null;
              }
            }),
          )
        ).filter((res): res is ToolMessage => !!res);

        log.trace({ toolResults }, "tool calls successfully executed");

        await persistItems(sessionId, senderUserId, toolResults, reqLog);

        log.trace("tool calls successfully persisted");
      } else {
        break;
      }
    }
  } catch (err) {
    reqLog.error({ err }, "OpenRouter call failed");
    captureException(err, { sessionId, requestId });
    throw err;
  }

  // const allItems: (NonStreamingChoice["message"] | ToolMessage)[] = [
  //   { role: "user", content: userMessage },
  //   // ...turnLog,
  //   choice.message,
  // ];

  // await persistItems(sessionId, senderUserId, allItems, reqLog);

  const durationMs = Date.now() - start;
  reqLog.info("agent loop complete");

  return { reply: choiceMessage.content ?? "", durationMs };
}
