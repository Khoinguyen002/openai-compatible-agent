/**
 * Export CLI — run with:
 *   npm run export                  → export current active session of each chat
 *   npm run export -- --all         → export ALL sessions (full history)
 *   npm run export -- --chat <id>   → export all sessions for a specific Telegram chat ID
 *
 * Output: exports/session_<uuid>.json  (one file per ChatSession)
 */

import "./config/index.js"; // loads dotenv
import { prisma } from "./db/client.js";
import { exportSession, exportChat } from "./modules/export/index.js";

const args = process.argv.slice(2);
const exportAll = args.includes("--all");
const chatFlagIdx = args.indexOf("--chat");
const chatIdArg = chatFlagIdx !== -1 ? args[chatFlagIdx + 1] : undefined;

async function run() {
  if (chatIdArg) {
    // Export all sessions for a specific chat
    const chatId = BigInt(chatIdArg);
    console.log(`\nExporting all sessions for chat ${chatId}...`);
    const results = await exportChat(chatId);

    if (results.length === 0) {
      console.log("No sessions found for this chat.");
    } else {
      for (const r of results) {
        console.log(`  ✔  ${r.filename}  (${r.turnCount} turns)`);
      }
      console.log(`\nDone — ${results.length} file(s) written to exports/`);
    }
    return;
  }

  if (exportAll) {
    // Export every session in the database
    const allSessions = await prisma.chatSession.findMany({
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    console.log(`\nExporting all ${allSessions.length} session(s)...`);

    let written = 0;
    let skipped = 0;
    for (const { id } of allSessions) {
      const result = await exportSession(id);
      if (result) {
        console.log(`  ✔  ${result.filename}  (${result.turnCount} turns)`);
        written++;
      } else {
        skipped++;
      }
    }

    console.log(`\nDone — ${written} file(s) written, ${skipped} skipped.`);
    return;
  }

  // Default: export the latest active session of each chat
  const activeSessions = await prisma.chatSession.findMany({
    where: { endedAt: null },
    select: { id: true, telegramChatId: true },
    orderBy: { createdAt: "desc" },
  });

  // Deduplicate: keep only the most recent active session per chat
  const seenChats = new Set<string>();
  const toExport = activeSessions.filter((s: { id: string; telegramChatId: bigint }) => {
    const key = s.telegramChatId.toString();
    if (seenChats.has(key)) return false;
    seenChats.add(key);
    return true;
  });

  console.log(
    `\nExporting ${toExport.length} active session(s) (one per chat)...`,
  );

  for (const { id } of toExport) {
    const result = await exportSession(id);
    if (result) {
      console.log(`  ✔  ${result.filename}  (${result.turnCount} turns)`);
    }
  }

  console.log(`\nDone — files written to exports/`);
}

run()
  .catch((err) => {
    console.error("Export failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
