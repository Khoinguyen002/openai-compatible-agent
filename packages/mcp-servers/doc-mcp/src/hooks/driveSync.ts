import {
  getProjectDocumentMetadata,
  deleteProjectDocument,
  upsertProjectDocument,
} from "../db/vector.js";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
// Remove childLogger dependency to fully decouple from core
// import { childLogger } from "@workspace/core";
import { config } from "../config.js";

const log = {
  info: (obj: any, msg: string) => console.log(`[driveSync] ${msg}`, obj),
  error: (obj: any, msg: string) => console.error(`[driveSync] ${msg}`, obj)
};

export async function syncProjectDriveFiles(
  projectId: string,
  onSyncMessage?: (msg: string) => void,
): Promise<void> {
  const dbMeta = await getProjectDocumentMetadata(projectId);
  const fileIds = Object.keys(dbMeta);

  if (fileIds.length === 0) return;

  log.info({ projectId, fileCount: fileIds.length }, "Checking Drive files for updates...");

  const { google } = await import("googleapis");

  const clientEmail = config.DOC_MCP_GOOGLE_CLIENT_EMAIL;
  let privateKey = config.DOC_MCP_GOOGLE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return;
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  const drive = google.drive({ version: "v3", auth });

  let updatedCount = 0;
  for (const fileId of fileIds) {
    try {
      const fileInfo = await drive.files.get({
        fileId: fileId,
        fields: "id, name, modifiedTime, trashed",
        supportsAllDrives: true,
      });

      if (fileInfo.data.trashed) {
        log.info({ fileId, projectId }, "File trashed on Drive, deleting from VectorDB...");
        await deleteProjectDocument(projectId, fileId);
        continue;
      }

      const driveModifiedTime = fileInfo.data.modifiedTime || "";
      const dbModifiedTime = dbMeta[fileId];

      if (driveModifiedTime !== dbModifiedTime) {
        if (onSyncMessage) {
          onSyncMessage(`🔄 Syncing updated file: ${fileInfo.data.name}...`);
        }
        
        log.info({ fileId, projectId }, "File updated on Drive, syncing...");
        await deleteProjectDocument(projectId, fileId);
        
        const res = await drive.files.export({
          fileId: fileId,
          mimeType: "text/plain",
        });
        
        const content = res.data;
        if (typeof content === "string" && content.trim() !== "") {
          const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: config.CHUNK_SIZE,
            chunkOverlap: config.CHUNK_OVERLAP,
          });
          const chunks = await splitter.splitText(content);
          
          for (const chunk of chunks) {
            await upsertProjectDocument(projectId, chunk, {
              title: fileInfo.data.name,
              file_id: fileId,
              source: "google_drive",
              modified_time: driveModifiedTime,
            });
          }
          updatedCount++;
        }
      }
    } catch (err: any) {
      if (err.code === 404) {
        log.info({ fileId, projectId }, "File not found on Drive, deleting from VectorDB...");
        await deleteProjectDocument(projectId, fileId);
      } else {
        log.error({ fileId, err: err.message }, "Error syncing drive file");
      }
    }
  }

  if (updatedCount > 0 && onSyncMessage) {
    onSyncMessage(`✅ Synced ${updatedCount} files from Google Drive.`);
  }
}
