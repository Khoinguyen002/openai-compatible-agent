import { config } from "@workspace/core";
import { childLogger } from "@workspace/core";
import { hydrateContext } from "./hydrate.js";
import { persistItems } from "./persistItems.js";
import { Message, callAgent, executeToolCalls, getTools, getChatPrompt } from "@workspace/llm-engine";
import { prisma } from "../db/client.js";

const log = childLogger({ module: "orchestrator" });

export interface OrchestrateOptions {
  sessionId: string;
  userMessage: string;
  senderUserId: bigint;
  requestId: string;
  onChoice?: NonNullable<
    Parameters<typeof callAgent>["0"]["events"]
  >["onChoice"];
  resumeAction?: "approve" | "reject";
  onApprovalRequest?: (tools: any[]) => Promise<void>;
}

export interface OrchestrateResult {
  reply: string;
  durationMs: number;
}

export async function orchestrate(
  opts: OrchestrateOptions,
): Promise<OrchestrateResult> {
  const {
    sessionId,
    userMessage,
    senderUserId,
    requestId,
    onChoice,
    resumeAction,
    onApprovalRequest,
  } = opts;
  const reqLog = log.child({ sessionId, requestId });
  const start = Date.now();
  const tools = await getTools({ excludedNames: ["send_telegram_message"] });

  reqLog.info({ preview: userMessage.slice(0, 80) }, "agent loop start");

  const initialHistory = await hydrateContext(sessionId);
  const lastMsg = initialHistory[initialHistory.length - 1];

  if (resumeAction) {
    if (
      lastMsg &&
      lastMsg.role === "assistant" &&
      lastMsg.tool_calls &&
      lastMsg.tool_calls.length > 0
    ) {
      let toolResults;
      if (resumeAction === "approve") {
        toolResults = await executeToolCalls(lastMsg.tool_calls, reqLog, { sessionId });
      } else {
        toolResults = lastMsg.tool_calls.map((tc: any) => ({
          role: "tool" as const,
          name: tc.function.name,
          tool_call_id: tc.id,
          content: "ERROR: The user rejected the execution of this tool.",
        }));
      }
      await persistItems(sessionId, senderUserId, toolResults, reqLog);
    }
  } else {
    if (
      lastMsg &&
      lastMsg.role === "assistant" &&
      lastMsg.tool_calls &&
      lastMsg.tool_calls.length > 0
    ) {
      throw new Error(
        "A tool call is currently waiting for your approval. Please press Approve or Reject before proceeding!",
      );
    }

    await persistItems(
      sessionId,
      senderUserId,
      [{ role: "user", content: userMessage }],
      reqLog,
    );
  }

  const getFullHistory = async () => {
    const latestHistory = await hydrateContext(sessionId);
    let sysPrompt = await getChatPrompt();

    return [
      {
        role: "system",
        content: sysPrompt,
      },
      ...latestHistory,
    ] satisfies Message[];
  };

  const results = await callAgent({
    messages: getFullHistory,
    tools,
    reqLogger: reqLog,
    events: {
      async onChoice(choiceMessage) {
        await onChoice?.(choiceMessage);
        return persistItems(sessionId, senderUserId, [choiceMessage], reqLog);
      },
      onToolCallSuccess(toolCallResults) {
        return persistItems(sessionId, senderUserId, toolCallResults, reqLog);
      },
    },
    context: { sessionId },
  });

  if (results.needsApproval && onApprovalRequest) {
    const history = await hydrateContext(sessionId);
    const updatedLastMsg = history[history.length - 1];
    if (
      updatedLastMsg &&
      updatedLastMsg.role === "assistant" &&
      updatedLastMsg.tool_calls
    ) {
      await onApprovalRequest(updatedLastMsg.tool_calls);
    }
  }

  const durationMs = Date.now() - start;
  reqLog.info("agent loop complete");

  return { reply: results.reply ?? "", durationMs };
}
