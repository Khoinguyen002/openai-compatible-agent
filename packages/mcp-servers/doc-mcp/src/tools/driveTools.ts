import { randomUUID } from "crypto";
import { google } from "googleapis";
import { config } from "../config.js";
import { deletePointsByIds, getBlockPointId } from "../db/vector.js";
import { getAllSyncEntries, deleteSyncEntry, tryAcquireSyncLock, releaseSyncLock } from "../db/syncState.js";
import { removeFileChunks } from "../db/chunkCache.js";
import { syncSingleDocument } from "./ingestFlow.js";

function getDriveClient() {
  const clientEmail = config.DOC_MCP_GOOGLE_CLIENT_EMAIL;
  let privateKey = config.DOC_MCP_GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error("Google Drive credentials not configured.");
  }

  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  return google.drive({ version: "v3", auth });
}

/**
 * List all Google Docs the Service Account can read.
 * Optional keyword filter on document title.
 */
export async function listDriveFiles(keyword?: string) {
  try {
    const drive = getDriveClient();
    let q =
      "mimeType = 'application/vnd.google-apps.document' and trashed = false";
    if (keyword) {
      const safe = keyword.replace(/'/g, "\\'");
      q = `name contains '${safe}' and ${q}`;
    }

    const allFiles: any[] = [];
    let pageToken: string | undefined;
    do {
      const res: any = await drive.files.list({
        q,
        fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
        spaces: "drive",
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      if (res.data.files) allFiles.push(...res.data.files);
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    return { success: true, results: allFiles };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Sync all documents the SA can see:
 * - New/changed files → syncSingleDocument()
 * - Files removed from Drive → delete from Qdrant + Redis
 */
export async function syncAllDocuments({ force = false }: { force?: boolean } = {}) {
  const syncIntervalMs = config.SYNC_INTERVAL_SECONDS * 1000;
  const instanceId = randomUUID();

  // ── Distributed lock: skip if fresh or another instance is syncing ──
  const lockResult = await tryAcquireSyncLock(syncIntervalMs, instanceId, force);
  if (!lockResult.acquired) {
    console.error(`[Sync] Skipped — ${lockResult.reason}`);
    return { success: true, skipped: true };
  }

  console.error(`[Sync] Lock acquired (instance=${instanceId.slice(0, 8)})`);

  try {
    const drive = getDriveClient();

    // List all docs (paginated)
    const allDocs: any[] = [];
    let pageToken: string | undefined;
    do {
      const res: any = await drive.files.list({
        q: "mimeType = 'application/vnd.google-apps.document' and trashed = false",
        fields: "nextPageToken, files(id, name, modifiedTime)",
        spaces: "drive",
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      if (res.data.files) allDocs.push(...res.data.files);
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    // Get all sync entries
    const syncEntries = await getAllSyncEntries();

    // Sync new or changed files
    for (const file of allDocs) {
      if (!file.id || !file.modifiedTime) continue;
      const existing = syncEntries[file.id];
      if (!existing || existing.modifiedTime !== file.modifiedTime) {
        console.error(`[Sync] Detected change: "${file.name}"`);
        await syncSingleDocument(
          file.id,
          file.modifiedTime,
          file.name || "Untitled",
        );
      }
    }

    // Clean up files removed from Drive
    const driveFileIds = new Set(allDocs.map((f) => f.id).filter(Boolean));
    for (const [fileId, entry] of Object.entries(syncEntries)) {
      if (!driveFileIds.has(fileId)) {
        console.error(`[Sync] Removing deleted doc: "${entry.title}"`);
        const pointIds = Array.from({ length: entry.blockCount }, (_, i) =>
          getBlockPointId(fileId, i),
        );
        await deletePointsByIds(pointIds);
        await deleteSyncEntry(fileId);
        removeFileChunks(fileId);
      }
    }

    // ── Release lock and stamp completion time ──
    const completedAt = new Date().toISOString();
    await releaseSyncLock(completedAt);
    console.error(`[Sync] Done — lock released, next sync after ${config.SYNC_INTERVAL_SECONDS}s`);

    return { success: true };
  } catch (err: any) {
    // Release lock on failure so other instances can retry
    await releaseSyncLock(lockResult.lastSyncCompletedAt ?? new Date(0).toISOString()).catch(() => {});
    console.error("syncAllDocuments failed:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Read a specific Google Drive document, triggering incremental sync first.
 * Returns paginated Markdown content.
 */
export async function readDriveDocument(
  fileId: string,
  offset: number = 0,
  limit: number = 10000,
) {
  try {
    const drive = getDriveClient();
    const fileInfo = await drive.files.get({
      fileId,
      fields: "id, name, modifiedTime",
      supportsAllDrives: true,
    });

    const modifiedTime = fileInfo.data.modifiedTime || "";
    const title = fileInfo.data.name || "Untitled";

    const result = await syncSingleDocument(fileId, modifiedTime, title);
    const content = result.content;
    const totalSize = content.length;
    const sliced = content.substring(offset, offset + limit);
    const isTruncated = offset + sliced.length < totalSize;

    let finalContent = sliced;
    let warning: string | undefined;
    if (isTruncated) {
      warning = `[WARNING]: This is not the entire document. Content has been truncated from character ${offset} to ${offset + sliced.length} out of ${totalSize} total characters. Please use 'offset' and 'limit' parameters to read the rest of the document, or use search_knowledge to query specific details.`;
      finalContent += `\n\n${warning}`;
    }

    return {
      success: true,
      data: {
        content: finalContent || "Empty document",
        metadata: { totalSize, offset, limit, isTruncated, warning },
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
