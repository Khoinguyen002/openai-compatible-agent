import type { ContextItem } from "@prisma/client";
import type { ChatMessages } from "@openrouter/sdk/models";
import { prisma } from "../db/client.js";
import { config } from "../config/index.js";
import { pruneContext } from "./prune.js";
import { childLogger } from "../logger.js";

const log = childLogger({ module: "hydrator" });

// Re-export so callers don't need to import from the SDK directly
export type { ChatMessages };

type StoredToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/**
 * Loads all prior context_items for the session, applies pruning if needed,
 * and converts rows to ChatMessages[] (the format fromChatMessages() expects).
 */
export async function hydrateContext(
  sessionId: string,
): Promise<ChatMessages[]> {
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

function rowToMessage(row: ContextItem): ChatMessages {
  if (row.role === "user") {
    return { role: "user", content: row.content ?? "" };
  }

  if (row.role === "tool") {
    return {
      role: "tool",
      toolCallId: row.toolCallId ?? "",
      content: row.content ?? "",
    };
  }

  // assistant row
  const toolCalls = row.toolCalls
    ? (JSON.parse(row.toolCalls) as StoredToolCall[])
    : null;

  if (toolCalls && toolCalls.length > 0) {
    return {
      role: "assistant",
      content: row.content ?? null,
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    };
  }

  return {
    role: "assistant",
    content: row.content ?? null,
    reasoning: row.reasoning ?? null,
  };
}
