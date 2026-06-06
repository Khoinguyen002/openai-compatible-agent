import { google } from "googleapis";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { prisma } from "../../../../db/client.js";
import { config } from "../../../../config/index.js";
import {
  searchProjectMemory,
  upsertProjectDocument,
  checkProjectDocumentExists,
  getProjectDocumentMetadata,
  deleteProjectDocument,
} from "../../../vector/index.js";

function getDriveClient() {
  const clientEmail = config.GOOGLE_CLIENT_EMAIL;
  let privateKey = config.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google Drive credentials not configured. Please set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY in .env",
    );
  }

  // Handle multiline private key correctly if provided via env var
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

export const driveToolImplementations: Record<
  string,
  (args: any, context?: any) => Promise<any>
> = {
  search_drive_tool: async (args: { keyword?: string }, context?: any) => {
    if (!context?.sessionId)
      return { success: false, error: "Missing sessionId in context" };

    const chatSession = await prisma.chatSession.findUnique({
      where: { id: context.sessionId },
      include: { project: true },
    });

    if (!chatSession?.project) {
      return {
        success: false,
        error:
          "This session is not associated with any project. Join a project first.",
      };
    }

    if (!chatSession.project.driveFolderId) {
      return {
        success: false,
        error:
          "No Google Drive folder linked to this project. Ask the user to link one using /prj_set_drive <folder_id>.",
      };
    }

    try {
      const drive = getDriveClient();
      // By default this query searches for Google Docs. You can modify mimeType if needed.
      let q = "mimeType = 'application/vnd.google-apps.document'";

      // Scope to project's linked drive folder
      q = `'${chatSession.project.driveFolderId}' in parents and ${q}`;

      if (args.keyword) {
        q = `name contains '${args.keyword}' and ${q}`;
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
  },

  ingest_drive_to_lancedb_tool: async (
    args: { fileId: string },
    context?: any,
  ) => {
    if (!context?.sessionId)
      return { success: false, error: "Missing sessionId in context" };

    const chatSession = await prisma.chatSession.findUnique({
      where: { id: context.sessionId },
    });

    if (!chatSession?.projectId) {
      return {
        success: false,
        error:
          "This session is not associated with any project. Join a project first.",
      };
    }

    try {
      const drive = getDriveClient();

      // 1. Fetch file info from Drive
      const fileInfo = await drive.files.get({
        fileId: args.fileId,
        fields: "id, name, modifiedTime",
        supportsAllDrives: true,
      });

      const driveModifiedTime = fileInfo.data.modifiedTime || "";

      // 2. Check if already ingested and up-to-date
      const dbMetaMap = await getProjectDocumentMetadata(chatSession.projectId);
      const dbModifiedTime = dbMetaMap[args.fileId];

      if (dbModifiedTime && dbModifiedTime === driveModifiedTime) {
        return {
          success: true,
          message: `File '${fileInfo.data.name}' is already up-to-date in project memory.`,
        };
      }

      // If updating, delete old chunks first
      if (dbModifiedTime) {
        await deleteProjectDocument(chatSession.projectId, args.fileId);
      }

      // 3. Download from Drive
      const res = await drive.files.export({
        fileId: args.fileId,
        mimeType: "text/plain",
      });

      const content = res.data;
      if (typeof content !== "string" || content.trim() === "") {
        return { success: false, error: "Empty or invalid file content" };
      }

      // 4. Chunking using config sizes
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: config.CHUNK_SIZE,
        chunkOverlap: config.CHUNK_OVERLAP,
      });
      const chunks = await splitter.splitText(content);

      // 5. Embedding and saving to LanceDB
      for (const chunk of chunks) {
        await upsertProjectDocument(chatSession.projectId, chunk, {
          title: fileInfo.data.name || "Untitled Google Doc",
          source: "google_drive",
          file_id: args.fileId,
          modified_time: driveModifiedTime,
          sessionId: context.sessionId,
        });
      }

      return {
        success: true,
        message: `Successfully ingested '${fileInfo.data.name}' into project memory (${chunks.length} chunks).`,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
};
