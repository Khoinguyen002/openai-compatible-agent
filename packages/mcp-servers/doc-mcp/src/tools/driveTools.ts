import { google } from "googleapis";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { config } from "../config.js";
import {
  upsertProjectDocument,
  getProjectDocumentMetadata,
  deleteProjectDocument,
} from "../db/vector.js";

function getDriveClient() {
  const clientEmail = config.DOC_MCP_GOOGLE_CLIENT_EMAIL;
  let privateKey = config.DOC_MCP_GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google Drive credentials not configured. Please set DOC_MCP_GOOGLE_CLIENT_EMAIL and DOC_MCP_GOOGLE_PRIVATE_KEY in .env",
    );
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

export async function listDriveFiles(keyword?: string, targetFolderId?: string) {
  const folderId = targetFolderId || config.DOC_MCP_DRIVE_FOLDER_ID;
  if (!folderId) {
    return {
      success: false,
      error: "DOC_MCP_DRIVE_FOLDER_ID is not configured for this agent.",
    };
  }

  try {
    const drive = getDriveClient();
    let q = "(mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.folder') and trashed = false";
    q = `'${folderId}' in parents and ${q}`;

    if (keyword) {
      q = `name contains '${keyword}' and ${q}`;
    }

    const res = await drive.files.list({
      q,
      fields: "files(id, name, description, mimeType)",
      spaces: "drive",
      pageSize: 50,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = res.data.files;
    if (!files || files.length === 0) {
      return { success: true, results: [] };
    }

    return { success: true, results: files };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function syncSingleDocument(fileId: string, folderId: string) {
  const drive = getDriveClient();
  const fileInfo = await drive.files.get({
    fileId,
    fields: "id, name, modifiedTime",
    supportsAllDrives: true,
  });

  const driveModifiedTime = fileInfo.data.modifiedTime || "";
  const dbMetaMap = await getProjectDocumentMetadata(folderId);
  const dbModifiedTime = dbMetaMap[fileId];

  if (!dbModifiedTime || dbModifiedTime !== driveModifiedTime) {
    if (dbModifiedTime) {
      await deleteProjectDocument(folderId, fileId);
    }

    const res = await drive.files.export({
      fileId: fileId,
      mimeType: "text/plain",
    });

    const content = res.data;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("Empty or invalid file content");
    }

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: config.CHUNK_SIZE,
      chunkOverlap: config.CHUNK_OVERLAP,
    });
    const chunks = await splitter.splitText(content);

    for (const chunk of chunks) {
      await upsertProjectDocument(folderId, chunk, {
        title: fileInfo.data.name || "Untitled Google Doc",
        source: "google_drive",
        file_id: fileId,
        modified_time: driveModifiedTime,
      });
    }
    return { synced: true, content, driveModifiedTime };
  }

  return { synced: false, driveModifiedTime };
}

export async function readDriveDocument(fileId: string) {
  const folderId = config.DOC_MCP_DRIVE_FOLDER_ID;
  if (!folderId) {
    return {
      success: false,
      error: "DOC_MCP_DRIVE_FOLDER_ID is not configured for this agent.",
    };
  }

  try {
    const result = await syncSingleDocument(fileId, folderId);

    // If not synced just now, we need to fetch content to return to the user
    let content = result.content;
    if (!content) {
      const drive = getDriveClient();
      const res = await drive.files.export({
        fileId: fileId,
        mimeType: "text/plain",
      });
      content = typeof res.data === "string" ? res.data : "";
    }

    let finalContent = content;
    const MAX_CHARS = 10000;
    if (finalContent && finalContent.length > MAX_CHARS) {
      finalContent =
        finalContent.substring(0, MAX_CHARS) +
        "\n\n... [Content truncated due to length. The full document has been automatically ingested into Vector Memory. Use search_knowledge to query specific details.]";
    }

    return {
      success: true,
      content: finalContent || "Empty file",
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function syncFolderState(folderId: string) {
  try {
    const drive = getDriveClient();

    async function getAllDocumentsFlat(): Promise<any[]> {
      let allDocs: any[] = [];
      let pageToken: string | undefined = undefined;

      do {
        const docsRes: any = await drive.files.list({
          // Chú ý: Đéo check parentId nữa, gom sạch sành sanh mọi file .doc mà Service Account nhìn thấy
          q: `mimeType = 'application/vnd.google-apps.document' and trashed = false`,
          fields: "nextPageToken, files(id, name, modifiedTime)",
          spaces: "drive",
          pageSize: 100, // Google API limit mỗi page, tự động nhảy trang nếu nhiều hơn
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        
        if (docsRes.data.files) {
          allDocs = allDocs.concat(docsRes.data.files);
        }
        pageToken = docsRes.data.nextPageToken || undefined;
      } while (pageToken);

      return allDocs;
    }

    const driveFiles = await getAllDocumentsFlat();
    const dbMetaMap = await getProjectDocumentMetadata(folderId);

    // Sync updated or new files
    for (const file of driveFiles) {
      if (!file.id) continue;
      const dbModTime = dbMetaMap[file.id];
      if (!dbModTime || dbModTime !== file.modifiedTime) {
        await syncSingleDocument(file.id, folderId);
      }
    }

    // Delete removed files from DB
    for (const dbFileId of Object.keys(dbMetaMap)) {
      if (!driveFiles.find((f) => f.id === dbFileId)) {
        await deleteProjectDocument(folderId, dbFileId);
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error("Auto-sync failed:", err.message);
    return { success: false, error: err.message };
  }
}
