import type { ContextItem } from "@prisma/client";
import type { ChatMessages } from "@openrouter/sdk/models";
import { prisma } from "../db/client.js";
import { config } from "../config/index.js";
import { pruneContext } from "./prune.js";
import { childLogger } from "../logger.js";
import { Message, ToolCall } from "./type.js";

const log = childLogger({ module: "hydrator" });

// Re-export so callers don't need to import from the SDK directly
export type { ChatMessages };

/**
 * Loads all prior context_items for the session, applies pruning if needed,
 * and converts rows to ChatMessages[] (the format fromChatMessages() expects).
 */
export async function hydrateContext(sessionId: string): Promise<Message[]> {
  const rows = await prisma.contextItem.findMany({
    where: { sessionId },
    orderBy: { sequence: "asc" },
  });

  // const { rows: pruned, pruned: wasPruned, turnsRemoved } = pruneContext(
  //   rows,
  //   config.MODEL_CONTEXT_WINDOW_TOKENS,
  // );

  // if (wasPruned) {
  //   log.warn({ sessionId, turnsRemoved }, 'context pruned before hydration');
  // }

  // log.debug({ sessionId, totalRows: rows.length, afterPrune: pruned.length }, 'context hydrated');

  return rows.map(rowToMessage);
}

function rowToMessage(row: ContextItem): Message {
  if (row.role === "user") {
    return { role: "user", content: row.content ?? "" };
  }

  if (row.role === "tool") {
    return {
      role: "tool",
      tool_call_id: row.toolCallId ?? "",
      content: row.content ?? "",
      name: row.toolCalls
        ? ((JSON.parse(row.toolCalls) as ToolCall[]).find(
            (tc) => tc.id === row.toolCallId,
          )?.function.name ?? "")
        : "",
    };
  }

  // assistant row
  const toolCalls = row.toolCalls
    ? (JSON.parse(row.toolCalls) as ToolCall[])
    : null;

  if (toolCalls && toolCalls.length > 0) {
    return {
      role: "assistant",
      content: (row.content as string) ?? null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: JSON.stringify(tc.function.arguments),
        },
      })),
    };
  }

  return {
    role: "assistant",
    content: (row.content as string) ?? null,
  };
}
