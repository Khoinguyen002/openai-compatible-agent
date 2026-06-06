import { google } from "googleapis";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { config } from "@workspace/core";
import {
  upsertProjectDocument,
  getProjectDocumentMetadata,
  deleteProjectDocument,
} from "@workspace/vector-db";

function getDriveClient() {
  const clientEmail = config.GOOGLE_CLIENT_EMAIL;
  let privateKey = config.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google Drive credentials not configured. Please set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY in .env",
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

export async function searchDriveDocuments(keyword?: string) {
  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) {
    return {
      success: false,
      error: "DRIVE_FOLDER_ID is not configured for this agent.",
    };
  }

  try {
    const drive = getDriveClient();
    let q = "mimeType = 'application/vnd.google-apps.document'";
    q = `'${folderId}' in parents and ${q}`;

    if (keyword) {
      q = `name contains '${keyword}' and ${q}`;
    }

    const res = await drive.files.list({
      q,
      fields: "files(id, name, description)",
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

export async function ingestDriveDocument(fileId: string) {
  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) {
    return {
      success: false,
      error: "DRIVE_FOLDER_ID is not configured for this agent.",
    };
  }

  try {
    const drive = getDriveClient();

    const fileInfo = await drive.files.get({
      fileId,
      fields: "id, name, modifiedTime",
      supportsAllDrives: true,
    });

    const driveModifiedTime = fileInfo.data.modifiedTime || "";
    // Note: We use folderId as the "projectId" parameter for vector-db namespace
    const dbMetaMap = await getProjectDocumentMetadata(folderId);
    const dbModifiedTime = dbMetaMap[fileId];

    if (dbModifiedTime && dbModifiedTime === driveModifiedTime) {
      return {
        success: true,
        message: `File '${fileInfo.data.name}' is already up-to-date in project memory.`,
      };
    }

    if (dbModifiedTime) {
      await deleteProjectDocument(folderId, fileId);
    }

    const res = await drive.files.export({
      fileId: fileId,
      mimeType: "text/plain",
    });

    const content = res.data;
    if (typeof content !== "string" || content.trim() === "") {
      return { success: false, error: "Empty or invalid file content" };
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

    return {
      success: true,
      message: `Successfully ingested '${fileInfo.data.name}' into project memory (${chunks.length} chunks).`,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
