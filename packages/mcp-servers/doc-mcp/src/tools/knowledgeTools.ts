import { config } from "../config.js";
import { upsertProjectDocument, searchProjectMemory } from "../db/vector.js";
import { syncFolderState } from "./driveTools.js";

export async function saveAgentNote(content: string) {
  const folderId = config.DOC_MCP_DRIVE_FOLDER_ID;
  if (!folderId) {
    return {
      success: false,
      error: "DOC_MCP_DRIVE_FOLDER_ID is not configured.",
    };
  }
  try {
    await upsertProjectDocument(folderId, content, {
      source: "agent",
    });
    return {
      success: true,
      message: "Successfully stored note in vector memory.",
    };
  } catch (err: any) {
    return { success: false, error: `Failed to store note: ${err.message}` };
  }
}

export async function searchKnowledge(query: string, topK: number = 3) {
  const folderId = config.DOC_MCP_DRIVE_FOLDER_ID;
  if (!folderId) {
    return {
      success: false,
      error: "DOC_MCP_DRIVE_FOLDER_ID is not configured.",
    };
  }

  try {
    // Auto-sync folder state before searching
    await syncFolderState(folderId);

    const results = await searchProjectMemory(folderId, query, topK);

    if (!results || results.length === 0) {
      return { success: true, results: "NOT_FOUND" };
    }

    return {
      success: true,
      results: results.map((r: any) => {
        let title = "Unknown Source";
        let offset = undefined;
        if (r.metadata) {
          try {
            const metaObj = JSON.parse(r.metadata);
            if (metaObj.title) title = metaObj.title;
            if (metaObj.offset !== undefined) offset = metaObj.offset;
          } catch (e) {}
        }
        return {
          title,
          fileId: r.file_id || "N/A",
          offset,
          text: r.text,
        };
      }),
    };
  } catch (err: any) {
    return { success: false, error: `Failed to search: ${err.message}` };
  }
}
