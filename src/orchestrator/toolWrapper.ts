import { randomUUID } from "crypto";
import { tool } from "@openrouter/agent";
import { childLogger } from "../logger.js";
import { captureException } from "../sentry.js";

const log = childLogger({ module: "toolWrapper" });

export interface PendingContextItem {
  role: "user" | "assistant" | "tool";
  content?: string | null;
  reasoning?: string | null;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  toolCallId?: string | null;
}

type AgentTool = ReturnType<typeof tool>;

interface FunctionToolRecord {
  name: string;
  description?: string;
  inputSchema: Parameters<typeof tool>[0]["inputSchema"];
  execute?: (
    params: Record<string, unknown>,
    ctx?: unknown,
  ) => Promise<unknown>;
}

/**
 * Re-wraps each tool's execute() to capture invocations and results into
 * turnLog for trajectory persistence. Server tools (no `function` property)
 * and manual tools (no `execute`) are passed through unmodified.
 *
 * Call ID comes from ctx.toolCall.callId (FunctionCallItem.callId) injected
 * by the agent SDK; falls back to a fresh UUID if not present.
 */
export function wrapToolsForLogging(
  tools: AgentTool[],
  turnLog: PendingContextItem[],
): AgentTool[] {
  return tools.map((t) => {
    // Cast to an interface that models the `function` property as optional —
    // server tools won't have it; client-side function tools will.
    const fn = (t as { function?: FunctionToolRecord }).function;
    if (!fn || typeof fn.execute !== "function") return t;

    const originalExecute = fn.execute;

    return tool({
      name: fn.name,
      description: fn.description,
      inputSchema: fn.inputSchema,
      execute: async (params, ctx) => {
        const callId = ctx?.toolCall?.callId ?? randomUUID();

        log.trace({ tool: fn.name, callId, params }, "tool invoked");

        turnLog.push({
          role: "assistant",
          toolCalls: [{ id: callId, name: fn.name, arguments: params }],
        });

        try {
          const output = await originalExecute(params, ctx);
          const content =
            typeof output === "string" ? output : JSON.stringify(output);

          log.trace({ tool: fn.name, callId }, "tool succeeded");
          turnLog.push({ role: "tool", toolCallId: callId, content });

          return output;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error({ tool: fn.name, callId, err }, "tool execution failed");
          captureException(err, { tool: fn.name, callId });
          turnLog.push({
            role: "tool",
            toolCallId: callId,
            content: JSON.stringify({ error: message }),
          });
          throw err;
        }
      },
    });
  });
}
