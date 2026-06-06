import { config } from "../../../config/index.js";
import { childLogger } from "../../logger/index.js";
import { hydrateContext } from "./hydrate.js";
import { persistItems } from "./persistItems.js";
import { Message } from "./types/index.js";
import { getTools } from "../tools/index.js";
import { callAgent, executeToolCalls } from "./pure-agent.js";
import { getChatPrompt } from "../prompts/index.js";
import { prisma } from "../../../db/client.js";

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
    const chatSession = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { project: true }
    });

    let sysPrompt = await getChatPrompt();
    if (chatSession?.project) {
      sysPrompt += `\n\n<b>PROJECT CONTEXT ACTIVE</b>: You are currently joined to Project: "${chatSession.project.title}" - ${chatSession.project.description || 'No description'}.\nIMPORTANT: This "Project" refers to a Vector Database memory space, NOT a local codebase directory. Your local codebase is always the global 'workspace/' directory. If the user asks you to save, learn, or memorize documents, text, rules, or decisions for this Project, you MUST use the 'store_project_knowledge' tool. NEVER use 'write_file' to save project knowledge or READMEs unless the user explicitly commands you to "write to the local file system".      You have access to the Project's Vector Database for retrieving knowledge and context.
      
      JIT INGESTION RULE (STRICT):
      1. ALWAYS start by using 'search_project_knowledge' to answer project-related questions.
      2. If 'search_project_knowledge' returns "NOT_FOUND", it means the relevant context is NOT in the database yet.
      3. ONLY THEN, you MUST use 'search_drive_tool' to find the relevant document on Google Drive.
      4. If you find a relevant file on Drive, you MUST use 'ingest_drive_to_lancedb_tool' to learn it.
      5. After ingestion is successful, you MUST retry 'search_project_knowledge' to get the actual content before answering.`;
    }

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
