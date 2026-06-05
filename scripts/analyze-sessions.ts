/**
 * Session Analysis Script — Prompt Optimization Tool
 *
 * Usage:
 *   npx tsx scripts/analyze-sessions.ts exports/all_sessions_<timestamp>.jsonl
 *
 * Output:
 *   exports/analysis_<timestamp>.md
 *
 * Hallucination detection strategy (2-layer):
 *   Layer 1: Rule-based structural detection (catches definite + candidate cases)
 *   Layer 2: "Candidates for AI Review" section — compact context for human/AI verdict
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types (mirrors export/types.ts but standalone)
// ---------------------------------------------------------------------------

interface Turn {
  role: "user" | "assistant" | "tool";
  content: string | null;
  reasoning?: string;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  tool_call_id?: string;
  createdAt: string;
}

interface Session {
  id: string;
  telegramChatId: string;
  createdAt: string;
  endedAt: string | null;
  turns: Turn[];
}

interface SessionExport {
  version: string;
  exportedAt: string;
  systemPrompt: string;
  session: Session;
}

// ---------------------------------------------------------------------------
// Signal types
// ---------------------------------------------------------------------------

interface Hallucination {
  sessionId: string;
  turnIndex: number;
  pattern: string;
  userTrigger: string;
  detail: string;
  reasoning?: string;
  confidence: "HIGH" | "MEDIUM";
}

/** Candidate that needs AI/human review — not a definite hallucination */
interface ReviewCandidate {
  sessionId: string;
  turnIndex: number;
  pattern: string;
  context: string; // compact multi-turn context
  question: string; // what the reviewer should answer
}

interface ToolFailure {
  sessionId: string;
  turnIndex: number;
  toolName: string;
  result: string;
}

interface GuideSkip {
  sessionId: string;
  turnIndex: number;
  tool: string;
  guide: string;
}

interface LongSession {
  sessionId: string;
  turnCount: number;
  firstUserMessage: string;
}

interface RepeatedCorrection {
  sessionId: string;
  turnIndex: number;
  assistantContent: string;
  correctionContent: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastUserMessage(turns: Turn[], before: number): string {
  for (let i = before - 1; i >= 0; i--) {
    if (turns[i].role === "user" && turns[i].content) {
      return turns[i].content!.slice(0, 150);
    }
  }
  return "(unknown)";
}

function isToolFailure(content: string): boolean {
  try {
    const parsed = JSON.parse(content);
    if (parsed.success === false) return true;
    if (typeof parsed.error === "string") return true;
  } catch {
    if (content.toLowerCase().includes('"success":false')) return true;
  }
  return false;
}

const GUIDE_TOOLS: Record<string, string> = {
  register_cron: "workspace/skills/cron/guide.md",
  register_tool: "workspace/skills/tools/guide.md",
  memory_write: "workspace/skills/memory/guide.md",
  memory_read: "workspace/skills/memory/guide.md",
};

function prevToolCallNames(turns: Turn[], before: number, window = 5): string[] {
  const names: string[] = [];
  for (let i = Math.max(0, before - window); i < before; i++) {
    const t = turns[i];
    if (t.role === "assistant" && t.tool_calls) {
      for (const tc of t.tool_calls) names.push(tc.name);
    }
  }
  return names;
}

/** Collect all tool names called between two turn indices (exclusive) */
function toolCallsBetween(turns: Turn[], fromIdx: number, toIdx: number): string[] {
  const names: string[] = [];
  for (let i = fromIdx + 1; i < toIdx; i++) {
    if (turns[i].role === "assistant" && turns[i].tool_calls) {
      for (const tc of turns[i].tool_calls!) names.push(tc.name);
    }
  }
  return names;
}

/** Collect tool names called in the ENTIRE batch ending at this assistant turn
 *  (i.e., all tool_call + tool result pairs before the final assistant content) */
function toolCallsInBatch(turns: Turn[], assistantContentIdx: number): string[] {
  const names: string[] = [];
  // Walk backwards from assistantContentIdx to find tool results and their calls
  for (let i = assistantContentIdx - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role === "user") break; // stop at previous user message
    if (t.role === "assistant" && t.tool_calls) {
      for (const tc of t.tool_calls) names.push(tc.name);
    }
  }
  return names;
}

/** Compact context window around a turn for AI review */
function extractContext(turns: Turn[], centerIdx: number, windowBefore = 3, windowAfter = 1): string {
  const start = Math.max(0, centerIdx - windowBefore);
  const end = Math.min(turns.length - 1, centerIdx + windowAfter);
  const lines: string[] = [];

  for (let i = start; i <= end; i++) {
    const t = turns[i];
    const marker = i === centerIdx ? ">>>" : "   ";

    if (t.role === "user") {
      lines.push(`${marker} [${i}] USER: ${(t.content ?? "").slice(0, 200)}`);
    } else if (t.role === "assistant") {
      if (t.tool_calls) {
        for (const tc of t.tool_calls) {
          lines.push(`${marker} [${i}] CALL: ${tc.name}(${tc.arguments.slice(0, 120)})`);
        }
      }
      if (t.content) {
        lines.push(`${marker} [${i}] AGENT: ${t.content.slice(0, 250)}`);
      }
      if (t.reasoning) {
        lines.push(`${marker} [${i}] REASONING: ${t.reasoning.slice(0, 150)}`);
      }
    } else if (t.role === "tool") {
      lines.push(`${marker} [${i}] RESULT: ${(t.content ?? "").slice(0, 150)}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Action verbs extracted from content
// ---------------------------------------------------------------------------

/** Maps verbs in assistant content to expected tool calls */
const ACTION_TO_TOOL: Array<{ verbs: string[]; expectedTools: string[] }> = [
  {
    verbs: [
      "created a new cron", "registered a new cron", "scheduled a new cron",
      "set up a new cron", "created a cron", "and created a new one",
      "created a new one that", "registered a new",
    ],
    expectedTools: ["register_cron"],
  },
  {
    verbs: [
      "removed the cron", "deleted the cron", "uninstalled the cron",
      "removed the previous", "i've removed the",
    ],
    expectedTools: ["delete_extension"],
  },
  {
    verbs: [
      "created a new tool", "registered a new tool",
      "set up a new tool", "created a tool",
    ],
    expectedTools: ["register_tool"],
  },
  {
    verbs: [
      "removed the tool", "deleted the tool", "uninstalled the tool",
    ],
    expectedTools: ["delete_extension"],
  },
  {
    verbs: [
      "saved to memory", "written to memory", "stored in memory", "updated memory",
    ],
    expectedTools: ["memory_write"],
  },
];

function detectClaimedActions(content: string): string[] {
  const lc = content.toLowerCase();
  const claimed: string[] = [];
  for (const mapping of ACTION_TO_TOOL) {
    for (const verb of mapping.verbs) {
      if (lc.includes(verb)) {
        claimed.push(...mapping.expectedTools);
        break;
      }
    }
  }
  return [...new Set(claimed)];
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function analyzeSession(session: Session) {
  const hallucinations: Hallucination[] = [];
  const reviewCandidates: ReviewCandidate[] = [];
  const toolFailures: ToolFailure[] = [];
  const guideSkips: GuideSkip[] = [];
  const repeatedCorrections: RepeatedCorrection[] = [];

  const turns = session.turns;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];

    // =====================================================================
    // HALLUCINATION DETECTION — multiple structural patterns
    // =====================================================================

    if (turn.role === "assistant" && !turn.tool_calls && turn.content) {

      // --- Pattern 1: Compound action claim ---
      // Agent claims to have done multiple things (e.g. "deleted and created")
      // but batch tool_calls only cover a subset
      const claimedTools = detectClaimedActions(turn.content);
      if (claimedTools.length > 0) {
        const actualToolsInBatch = toolCallsInBatch(turns, i);

        const missingTools = claimedTools.filter(
          (expected) => !actualToolsInBatch.includes(expected)
        );

        if (missingTools.length > 0) {
          hallucinations.push({
            sessionId: session.id,
            turnIndex: i,
            pattern: "compound_claim",
            userTrigger: lastUserMessage(turns, i),
            detail: `Claimed: [${claimedTools.join(", ")}] — Actually called: [${actualToolsInBatch.join(", ") || "none"}] — Missing: [${missingTools.join(", ")}]`,
            reasoning: turn.reasoning?.slice(0, 200),
            confidence: missingTools.length === claimedTools.length ? "HIGH" : "MEDIUM",
          });
        }
      }

      // --- Pattern 2: Generic action claim with no preceding tool result ---
      // Simpler catch-all: assistant claims any action word, and the previous
      // turn is NOT a tool result
      if (claimedTools.length === 0) {
        const genericActionWords = [
          "i've created", "i've registered", "i've set up",
          "i've updated", "i've deleted", "i've removed", "i've scheduled",
          "successfully created", "successfully registered",
          "has been created", "has been registered", "has been scheduled",
        ];
        const lc = turn.content.toLowerCase();
        const matched = genericActionWords.find((w) => lc.includes(w));

        if (matched) {
          const prevTurn = turns[i - 1];
          const prevIsToolResult = prevTurn && prevTurn.role === "tool";
          if (!prevIsToolResult) {
            // Not definite — add as review candidate
            reviewCandidates.push({
              sessionId: session.id,
              turnIndex: i,
              pattern: "generic_action_claim",
              context: extractContext(turns, i),
              question: `Agent says "${matched}" but previous turn is not a tool result. Did the agent actually perform the action via tool calls in this batch?`,
            });
          }
        }
      }
    }

    // --- Pattern 3: Delete-then-create without follow-through ---
    // delete_extension called → success → but no register_cron/register_tool follows
    if (
      turn.role === "tool" &&
      turn.content &&
      turn.content.includes('"success":true')
    ) {
      // Find the tool call that produced this result
      const callerTurn = turns
        .slice(0, i)
        .reverse()
        .find((t) => t.role === "assistant" && t.tool_calls);
      const calledTool = callerTurn?.tool_calls?.find(
        (tc) => tc.id === turn.tool_call_id
      );

      if (calledTool?.name === "delete_extension") {
        // Check: does the rest of the session have a matching register_*?
        let args: any;
        try { args = JSON.parse(calledTool.arguments); } catch { args = {}; }
        const deletedType = args.type; // "cron" or "tool"

        const expectedRegister = deletedType === "cron" ? "register_cron" : "register_tool";
        const subsequentCalls = toolCallsBetween(turns, i, turns.length);
        const hasRegister = subsequentCalls.includes(expectedRegister);

        if (!hasRegister) {
          // Check: does the final assistant content claim creation?
          const finalAssistant = turns
            .slice(i + 1)
            .find((t) => t.role === "assistant" && t.content && !t.tool_calls);

          if (finalAssistant?.content) {
            const claimCreation = detectClaimedActions(finalAssistant.content)
              .includes(expectedRegister);

            if (claimCreation) {
              const fIdx = turns.indexOf(finalAssistant);
              hallucinations.push({
                sessionId: session.id,
                turnIndex: fIdx,
                pattern: "delete_without_recreate",
                userTrigger: lastUserMessage(turns, fIdx),
                detail: `delete_extension(${args.type}: "${args.name}") succeeded, agent claims ${expectedRegister} but it was never called`,
                reasoning: finalAssistant.reasoning?.slice(0, 200),
                confidence: "HIGH",
              });
            } else {
              // Deleted without recreating, but also didn't claim to recreate — might be intentional
              // Still worth flagging if user asked to "modify" or "change" or "update"
              const userMsg = lastUserMessage(turns, i).toLowerCase();
              const modifyWords = ["modify", "change", "update", "make it", "edit", "adjust", "switch"];
              if (modifyWords.some((w) => userMsg.includes(w))) {
                reviewCandidates.push({
                  sessionId: session.id,
                  turnIndex: i,
                  pattern: "delete_modify_no_recreate",
                  context: extractContext(turns, i, 4, 3),
                  question: `User requested a modification. Agent deleted the ${deletedType} "${args.name}" but did not call ${expectedRegister} to recreate it. Was this intentional (user wanted deletion only) or a missed follow-through?`,
                });
              }
            }
          }
        }
      }
    }

    // --- Pattern 4: Promise without follow-through ---
    // Assistant says "I'll do X" or "Let me do X" → next assistant turn has no tool_calls
    if (turn.role === "assistant" && turn.content && !turn.tool_calls) {
      const lc = turn.content.toLowerCase();
      const promiseWords = ["i'll ", "let me ", "i will ", "i'm going to "];
      const hasPromise = promiseWords.some((w) => lc.includes(w));

      if (hasPromise && i + 1 < turns.length) {
        // Look at the very next turn
        const next = turns[i + 1];
        // If next turn is also assistant (not user asking something new) and has no tool_calls
        if (next.role === "assistant" && !next.tool_calls) {
          reviewCandidates.push({
            sessionId: session.id,
            turnIndex: i,
            pattern: "promise_no_action",
            context: extractContext(turns, i, 2, 2),
            question: `Agent promised to take action but the next assistant turn has no tool calls. Did the agent follow through?`,
          });
        }
      }
    }

    // =====================================================================
    // OTHER DETECTORS (unchanged)
    // =====================================================================

    // --- Tool failures ---
    if (turn.role === "tool" && turn.content) {
      if (isToolFailure(turn.content)) {
        const prevAssistant = turns
          .slice(0, i)
          .reverse()
          .find((t) => t.role === "assistant" && t.tool_calls);
        const toolName = prevAssistant?.tool_calls?.find(
          (tc) => tc.id === turn.tool_call_id
        )?.name ?? "(unknown)";

        toolFailures.push({
          sessionId: session.id,
          turnIndex: i,
          toolName,
          result: turn.content.slice(0, 200),
        });
      }
    }

    // --- Guide skipped ---
    if (turn.role === "assistant" && turn.tool_calls) {
      for (const tc of turn.tool_calls) {
        const requiredGuide = GUIDE_TOOLS[tc.name];
        if (requiredGuide) {
          const prev = prevToolCallNames(turns, i, 8);
          const readGuide = prev.some((n) => n === "read_file" || n === "read_text_file");
          if (!readGuide) {
            guideSkips.push({
              sessionId: session.id,
              turnIndex: i,
              tool: tc.name,
              guide: requiredGuide,
            });
          }
        }
      }
    }

    // --- Repeated user correction ---
    if (turn.role === "user" && turn.content && i > 0) {
      const prev = turns[i - 1];
      if (prev.role === "assistant" && prev.content) {
        const correctionWords = [
          "no,", "that's wrong", "not correct", "wrong", "that's not",
          "i said", "re-read", "again", "still", "didn't", "you missed",
          "lại", "sai", "không phải", "không đúng",
        ];
        const c = turn.content.toLowerCase();
        if (correctionWords.some((w) => c.startsWith(w) || c.includes(w))) {
          repeatedCorrections.push({
            sessionId: session.id,
            turnIndex: i,
            assistantContent: prev.content.slice(0, 150),
            correctionContent: turn.content.slice(0, 150),
          });
        }
      }
    }
  }

  return { hallucinations, reviewCandidates, toolFailures, guideSkips, repeatedCorrections };
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function formatReport(
  sessions: SessionExport[],
  allHallucinations: Hallucination[],
  allCandidates: ReviewCandidate[],
  allToolFailures: ToolFailure[],
  allGuideSkips: GuideSkip[],
  allCorrections: RepeatedCorrection[],
  longSessions: LongSession[]
): string {
  const totalTurns = sessions.reduce((s, e) => s + e.session.turns.length, 0);
  const lines: string[] = [];

  lines.push(`# Session Analysis Report`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Sessions analyzed | ${sessions.length} |`);
  lines.push(`| Total turns | ${totalTurns} |`);
  lines.push(`| Avg turns/session | ${(totalTurns / sessions.length).toFixed(1)} |`);
  lines.push(`| Hallucinations (confirmed) | ${allHallucinations.length} |`);
  lines.push(`| Candidates for AI review | ${allCandidates.length} |`);
  lines.push(`| Tool failures | ${allToolFailures.length} |`);
  lines.push(`| Guide skips | ${allGuideSkips.length} |`);
  lines.push(`| User corrections | ${allCorrections.length} |`);
  lines.push(`| Long sessions (>10 turns) | ${longSessions.length} |`);
  lines.push(``);

  // --- Hallucinations (confirmed) ---
  if (allHallucinations.length > 0) {
    lines.push(`## ⚠️ Confirmed Hallucinations (${allHallucinations.length})`);
    lines.push(`Agent claimed an action that tool call history does not support.\n`);
    for (const h of allHallucinations) {
      lines.push(`### Session \`${h.sessionId.slice(0, 8)}\` — turn ${h.turnIndex} [${h.confidence}]`);
      lines.push(`- **Pattern**: \`${h.pattern}\``);
      lines.push(`- **User trigger**: ${h.userTrigger}`);
      lines.push(`- **Detail**: ${h.detail}`);
      if (h.reasoning) lines.push(`- **Reasoning**: ${h.reasoning}`);
      lines.push(``);
    }
  }

  // --- Candidates for AI Review ---
  if (allCandidates.length > 0) {
    lines.push(`## 🔍 Candidates for AI Review (${allCandidates.length})`);
    lines.push(`These turns have suspicious patterns but need human/AI judgment.\n`);
    lines.push(`> When reviewing, classify each as: **HALLUCINATION**, **FALSE_POSITIVE**, or **AMBIGUOUS**\n`);
    for (const c of allCandidates) {
      lines.push(`### Session \`${c.sessionId.slice(0, 8)}\` — turn ${c.turnIndex}`);
      lines.push(`- **Pattern**: \`${c.pattern}\``);
      lines.push(`- **Question**: ${c.question}`);
      lines.push(`\`\`\``);
      lines.push(c.context);
      lines.push(`\`\`\``);
      lines.push(``);
    }
  }

  // --- Tool Failures ---
  if (allToolFailures.length > 0) {
    lines.push(`## ❌ Tool Failures (${allToolFailures.length})`);
    lines.push(``);
    for (const f of allToolFailures) {
      lines.push(`### Session \`${f.sessionId.slice(0, 8)}\` — turn ${f.turnIndex}`);
      lines.push(`- **Tool**: \`${f.toolName}\``);
      lines.push(`- **Result**: \`${f.result}\``);
      lines.push(``);
    }
  }

  // --- Guide Skips ---
  if (allGuideSkips.length > 0) {
    lines.push(`## 📖 Guide Skips (${allGuideSkips.length})`);
    lines.push(`Agent called a skill tool without reading its guide first.\n`);
    for (const g of allGuideSkips) {
      lines.push(`- Session \`${g.sessionId.slice(0, 8)}\` turn ${g.turnIndex}: \`${g.tool}\` (required: \`${g.guide}\`)`);
    }
    lines.push(``);
  }

  // --- Repeated corrections ---
  if (allCorrections.length > 0) {
    lines.push(`## 🔁 User Corrections (${allCorrections.length})`);
    lines.push(`User had to correct the agent's previous response.\n`);
    for (const c of allCorrections) {
      lines.push(`### Session \`${c.sessionId.slice(0, 8)}\` — turn ${c.turnIndex}`);
      lines.push(`- **Agent said**: ${c.assistantContent}`);
      lines.push(`- **User corrected**: ${c.correctionContent}`);
      lines.push(``);
    }
  }

  // --- Long sessions ---
  if (longSessions.length > 0) {
    lines.push(`## 📏 Long Sessions (${longSessions.length})`);
    lines.push(`Sessions with >10 turns — agent may be inefficient or user intent was mishandled.\n`);
    for (const s of longSessions) {
      lines.push(`- \`${s.sessionId.slice(0, 8)}\` — ${s.turnCount} turns — first msg: "${s.firstUserMessage}"`);
    }
    lines.push(``);
  }

  const totalIssues =
    allHallucinations.length + allCandidates.length + allToolFailures.length +
    allGuideSkips.length + allCorrections.length + longSessions.length;

  if (totalIssues === 0) {
    lines.push(`\n✅ No significant issues detected.`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: npx tsx scripts/analyze-sessions.ts <path/to/all_sessions.jsonl>");
  process.exit(1);
}

const raw = readFileSync(inputFile, "utf-8");
const sessions: SessionExport[] = raw
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const allHallucinations: Hallucination[] = [];
const allCandidates: ReviewCandidate[] = [];
const allToolFailures: ToolFailure[] = [];
const allGuideSkips: GuideSkip[] = [];
const allCorrections: RepeatedCorrection[] = [];
const longSessions: LongSession[] = [];

for (const exported of sessions) {
  const session = exported.session;

  if (session.turns.length > 10) {
    const firstUser = session.turns.find((t) => t.role === "user");
    longSessions.push({
      sessionId: session.id,
      turnCount: session.turns.length,
      firstUserMessage: firstUser?.content?.slice(0, 100) ?? "(empty)",
    });
  }

  const result = analyzeSession(session);
  allHallucinations.push(...result.hallucinations);
  allCandidates.push(...result.reviewCandidates);
  allToolFailures.push(...result.toolFailures);
  allGuideSkips.push(...result.guideSkips);
  allCorrections.push(...result.repeatedCorrections);
}

const report = formatReport(
  sessions,
  allHallucinations,
  allCandidates,
  allToolFailures,
  allGuideSkips,
  allCorrections,
  longSessions
);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = join(process.cwd(), "exports", `analysis_${timestamp}.md`);
writeFileSync(outFile, report, "utf-8");

console.log(`\nAnalysis complete.`);
console.log(`  Sessions: ${sessions.length}`);
console.log(`  Hallucinations (confirmed): ${allHallucinations.length}`);
console.log(`  Candidates for review: ${allCandidates.length}`);
console.log(`  Tool failures: ${allToolFailures.length}`);
console.log(`  Guide skips: ${allGuideSkips.length}`);
console.log(`  User corrections: ${allCorrections.length}`);
console.log(`  Long sessions: ${longSessions.length}`);
console.log(`\n  ✔  ${outFile}`);
