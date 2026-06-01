import type { ContextItem } from '@prisma/client';
import { childLogger } from '../logger.js';

const log = childLogger({ module: 'pruner' });

/**
 * A logical turn is the atomic unit of pruning.
 * It groups rows that must be kept or removed together to maintain
 * the structural integrity required by the LLM API (every tool result
 * row must have a corresponding assistant row with matching tool_calls).
 */
interface LogicalTurn {
  rows: ContextItem[];
}

/**
 * Groups flat context_item rows (ordered by sequence ASC) into logical turns.
 *
 * Turn boundaries:
 *   - Each `role=user` row starts a new logical turn.
 *   - An `role=assistant` row with tool_calls starts a new turn and its
 *     subsequent `role=tool` rows are part of the same turn.
 *   - An `role=assistant` row without tool_calls is its own turn.
 */
export function groupIntoLogicalTurns(rows: ContextItem[]): LogicalTurn[] {
  const turns: LogicalTurn[] = [];
  let current: ContextItem[] = [];

  for (const row of rows) {
    if (row.role === 'user') {
      if (current.length > 0) turns.push({ rows: current });
      current = [row];
    } else if (row.role === 'assistant') {
      if (current.length > 0 && current[current.length - 1]?.role !== 'tool') {
        turns.push({ rows: current });
        current = [];
      }
      current.push(row);
    } else if (row.role === 'tool') {
      // Always belongs to the current turn (following an assistant row)
      current.push(row);
    }
  }

  if (current.length > 0) turns.push({ rows: current });
  return turns;
}

/**
 * Verifies that every tool row has a matching assistant row in the same turn.
 * Logs an error and returns false if the invariant is broken.
 */
export function verifyTurnIntegrity(turns: LogicalTurn[]): boolean {
  for (const turn of turns) {
    const assistantRow = turn.rows.find(r => r.role === 'assistant');
    const toolRows = turn.rows.filter(r => r.role === 'tool');

    if (toolRows.length > 0 && !assistantRow) {
      log.error({ turnRows: turn.rows.map(r => r.id) }, 'pruning invariant violated: tool row without assistant row');
      return false;
    }

    // toolCalls is stored as a JSON string in SQLite
    const parsedToolCalls = assistantRow?.toolCalls
      ? (JSON.parse(assistantRow.toolCalls) as Array<{ id: string }>)
      : null;
    const declaredCallIds = new Set<string>(parsedToolCalls?.map(tc => tc.id) ?? []);

    for (const toolRow of toolRows) {
      if (toolRow.toolCallId && !declaredCallIds.has(toolRow.toolCallId)) {
        log.error(
          { toolCallId: toolRow.toolCallId, declaredIds: [...declaredCallIds] },
          'pruning invariant violated: tool_call_id not found in assistant tool_calls',
        );
        return false;
      }
    }
  }
  return true;
}

/**
 * Estimates the token count of a serialized context array.
 * Uses a simple char-based heuristic (1 token ≈ 4 chars) — accurate enough
 * for threshold decisions without a heavy tiktoken dependency.
 */
export function estimateTokens(rows: ContextItem[]): number {
  const serialized = JSON.stringify(rows);
  return Math.ceil(serialized.length / 4);
}

export interface PruneResult {
  rows: ContextItem[];
  pruned: boolean;
  turnsRemoved: number;
}

/**
 * Prunes the context to fit within the model's context window.
 *
 * Strategy:
 *   - The system prompt (prepended separately) and the current user message
 *     (appended separately) are NOT in this array — only prior history is.
 *   - Drops oldest logical turns one at a time until estimated tokens fall
 *     below the threshold.
 *   - Verifies structural integrity before returning.
 */
export function pruneContext(
  rows: ContextItem[],
  maxTokens: number,
  /** Reserve tokens for system prompt + new user message + model output headroom */
  reservedTokens = 8_000,
): PruneResult {
  const budget = maxTokens - reservedTokens;

  if (estimateTokens(rows) <= budget) {
    return { rows, pruned: false, turnsRemoved: 0 };
  }

  const turns = groupIntoLogicalTurns(rows);
  let turnsRemoved = 0;

  while (turns.length > 1) {
    const currentTokens = estimateTokens(turns.flatMap(t => t.rows));
    if (currentTokens <= budget) break;

    // Drop the oldest (first) logical turn
    turns.shift();
    turnsRemoved++;
  }

  const prunedRows = turns.flatMap(t => t.rows);

  if (!verifyTurnIntegrity(turns)) {
    log.error('pruning produced an invalid context — returning original unpruned rows');
    return { rows, pruned: false, turnsRemoved: 0 };
  }

  log.warn({ turnsRemoved, remainingRows: prunedRows.length }, 'context pruned');
  return { rows: prunedRows, pruned: true, turnsRemoved };
}
