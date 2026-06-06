export interface ExportedTurn {
  role: "user" | "assistant" | "tool";
  content: string | null;
  /** Only present on assistant turns */
  reasoning?: string;
  /** Tool calls made by the assistant */
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  /** Only present on tool turns */
  tool_call_id?: string;
  /** Wall-clock timestamp of when this item was persisted */
  createdAt: string;
}

export interface ExportedSession {
  id: string;
  telegramChatId: string;
  createdAt: string;
  endedAt: string | null;
  turns: ExportedTurn[];
}

/**
 * Payload written to each export file.
 * One file = one ChatSession.
 */
export interface ConversationExport {
  /** Schema version — bump if the shape changes */
  version: "1.0";
  exportedAt: string;
  /** Snapshot of the system prompt active at export time */
  systemPrompt: string;
  session: ExportedSession;
}

/** Return value from exportSession / exportChat */
export interface ExportResult {
  sessionId: string;
  filepath: string;
  filename: string;
  turnCount: number;
  exportedAt: string;
}
