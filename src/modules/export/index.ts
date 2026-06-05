import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { prisma } from "../../db/client.js";
import { getChatPrompt } from "../llm/prompts/index.js";
import { childLogger } from "../logger/index.js";
import type {
  ConversationExport,
  ExportedSession,
  ExportedTurn,
  ExportResult,
} from "./types.js";

const log = childLogger({ module: "export" });

/** Root directory where all exports are written. */
const EXPORT_DIR = join(process.cwd(), "exports");

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export a single session by ID.
 * Writes one JSON file: exports/session_<id>.json
 * Returns null if the session does not exist.
 */
export async function exportSession(sessionId: string): Promise<ExportResult | null> {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: { contextItems: { orderBy: { sequence: "asc" } } },
  });

  if (!session) {
    log.warn({ sessionId }, "exportSession: session not found");
    return null;
  }

  return writeSessionFile(session);
}

/**
 * Export ALL sessions belonging to a Telegram chat.
 * Writes one JSON file per session: exports/session_<id>.json
 * Sessions are ordered oldest-first.
 */
export async function exportChat(
  telegramChatId: bigint,
): Promise<ExportResult[]> {
  const sessions = await prisma.chatSession.findMany({
    where: { telegramChatId },
    orderBy: { createdAt: "asc" },
    include: { contextItems: { orderBy: { sequence: "asc" } } },
  });

  log.info(
    { telegramChatId: telegramChatId.toString(), count: sessions.length },
    "exporting all sessions for chat",
  );

  const results: ExportResult[] = [];
  for (const session of sessions) {
    const result = await writeSessionFile(session);
    results.push(result);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type SessionWithItems = Awaited<
  ReturnType<typeof prisma.chatSession.findMany>
>[number] & {
  contextItems: Awaited<ReturnType<typeof prisma.contextItem.findMany>>;
};

async function writeSessionFile(session: SessionWithItems): Promise<ExportResult> {
  await mkdir(EXPORT_DIR, { recursive: true });

  const payload: ConversationExport = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    systemPrompt: getChatPrompt(),
    session: sessionToExport(session),
  };

  const filename = `session_${session.id}.json`;
  const filepath = join(EXPORT_DIR, filename);

  await writeFile(filepath, JSON.stringify(payload, null, 2), "utf-8");

  log.info(
    { sessionId: session.id, filepath, turns: session.contextItems.length },
    "session exported",
  );

  return {
    sessionId: session.id,
    filepath,
    filename,
    turnCount: session.contextItems.length,
    exportedAt: payload.exportedAt,
  };
}

function sessionToExport(session: SessionWithItems): ExportedSession {
  return {
    id: session.id,
    telegramChatId: session.telegramChatId.toString(),
    createdAt: session.createdAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    turns: session.contextItems.map(itemToTurn),
  };
}

function itemToTurn(
  item: SessionWithItems["contextItems"][number],
): ExportedTurn {
  const base = {
    role: item.role as ExportedTurn["role"],
    content: item.content,
    createdAt: item.createdAt.toISOString(),
  };

  if (item.role === "assistant") {
    const toolCalls = item.toolCalls
      ? (JSON.parse(item.toolCalls) as Array<{
          id: string;
          function: { name: string; arguments: string };
        }>)
      : null;

    return {
      ...base,
      reasoning: item.reasoning ?? undefined,
      tool_calls: toolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
    };
  }

  if (item.role === "tool") {
    return { ...base, tool_call_id: item.toolCallId ?? undefined };
  }

  return base;
}
