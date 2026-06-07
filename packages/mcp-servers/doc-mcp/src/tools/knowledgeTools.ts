import { upsertProjectDocument, searchProjectMemory } from "../db/vector.js";

export async function storeKnowledge(content: string) {
  const folderId = process.env.DOC_MCP_DRIVE_FOLDER_ID;
  if (!folderId) {
    return { success: false, error: "DOC_MCP_DRIVE_FOLDER_ID is not configured." };
  }

  try {
    // We use folderId as the "projectId" parameter for vector-db namespace
    await upsertProjectDocument(folderId, content, {
      source: "agent",
    });
    return { success: true, message: "Successfully stored in folder memory." };
  } catch (err: any) {
    return { success: false, error: `Failed to store: ${err.message}` };
  }
}

export async function searchKnowledge(query: string, topK: number = 3) {
  const folderId = process.env.DOC_MCP_DRIVE_FOLDER_ID;
  if (!folderId) {
    return { success: false, error: "DOC_MCP_DRIVE_FOLDER_ID is not configured." };
  }

  try {
    const results = await searchProjectMemory(folderId, query, topK);

    if (!results || results.length === 0) {
      return { success: true, results: "NOT_FOUND" };
    }

    return {
      success: true,
      results: results.map((r: any) => r.text).join("\n\n---\n\n"),
    };
  } catch (err: any) {
    return { success: false, error: `Failed to search: ${err.message}` };
  }
}
