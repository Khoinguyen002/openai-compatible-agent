import { config } from "../../../config/index.js";
import { childLogger } from "../../logger/index.js";
import { hydrateContext } from "./hydrate.js";
import { persistItems } from "./persistItems.js";
import { Message } from "./type.js";
import { getTools } from "../tools/index.js";
import { callAgent } from "./pure-agent.js";

const log = childLogger({ module: "orchestrator" });

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

  await persistItems(
    sessionId,
    senderUserId,
    [{ role: "user", content: userMessage }],
    reqLog,
  );

  const getFullHistory = async () => {
    const latestHistory = await hydrateContext(sessionId);
    return [
      {
        role: "system",
        content:
          "You are an AI Agent strictly locked inside the 'workspace' directory. You are forbidden to access or modify anything outside of it. Core rules:\n" +
          "1. Read 'guides/soul.md' to understand your persona.\n" +
          "2. When (and ONLY when) creating/modifying extensions (tools, crons, etc.), you MUST first read 'guides/extensions.md' and exclusively use 'register_tool', 'register_cron', or 'delete_extension'. Manual 'write_file' on registries is strictly blocked.",
      },
      ...latestHistory,
    ] satisfies Message[];
  };

  const results = await callAgent({
    messages: getFullHistory,
    tools,
    reqLogger: reqLog,
    events: {
      onChoice(choiceMessage) {
        return persistItems(sessionId, senderUserId, [choiceMessage], reqLog);
      },
      onToolCallSuccess(toolCallResults) {
        return persistItems(sessionId, senderUserId, toolCallResults, reqLog);
      },
    },
  });

  const durationMs = Date.now() - start;
  reqLog.info("agent loop complete");

  return { reply: results.reply ?? "", durationMs };
}
