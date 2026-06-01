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

  reqLog.info({ preview: userMessage.slice(0, 80) }, "agent loop start");

  // Build message history — system prompt + prior context + new user message
  const history = await hydrateContext(sessionId);
  const fullHistory: ChatMessages[] = [
    { role: "system", content: config.SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage },
  ];

  console.log(fullHistory);

  // Wrap tools to capture trajectory for DB persistence
  const turnLog: PendingContextItem[] = [];
  const wrappedTools = wrapToolsForLogging([...registeredTools], turnLog);

  let finalText = "";
  let rawResponse: unknown = null;

  try {
    const result = openrouter.callModel({
      model: config.MODEL_ID,
      input: fromChatMessages(fullHistory) as Item[],
      tools: wrappedTools,
      // maxToolRounds: config.MAX_TOOL_ROUNDS,
      ...(config.REASONING_ENABLED ? { reasoning: { enabled: true } } : {}),
    });

    // Non-streaming: blocks until all tool rounds complete
    finalText = await result.getText();
    rawResponse = await result.getResponse();
  } catch (err) {
    reqLog.error({ err }, "OpenRouter call failed");
    captureException(err, { sessionId, requestId });
    throw err;
  }

  const reasoningText = extractReasoning(rawResponse);

  const allItems: PendingContextItem[] = [
    { role: "user", content: userMessage },
    ...turnLog,
    { role: "assistant", content: finalText, reasoning: reasoningText ?? null },
  ];

  await persistItems(sessionId, senderUserId, allItems, reqLog);

  const durationMs = Date.now() - start;
  reqLog.info(
    { durationMs, reasoningCaptured: !!reasoningText },
    "agent loop complete",
  );

  return { reply: finalText, durationMs };
}
