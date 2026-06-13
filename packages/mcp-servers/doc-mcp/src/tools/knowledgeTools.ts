import { searchProjectMemory, exactSearchChunks } from "../db/vector.js";
import { syncAllDocuments } from "./driveTools.js";

export async function searchKnowledge(query: string, topK: number = 3) {
  try {
    // Auto-sync all documents before searching
    await syncAllDocuments();

    const results = await searchProjectMemory(query, topK);

    if (!results || results.length === 0) {
      return { success: true, results: "NOT_FOUND" };
    }

    return {
      success: true,
      results: results.map((r: any) => ({
        title: r.title || "Unknown",
        fileId: r.file_id || null,
        offset: r.offset ?? 0,
        text: r.text,
      })),
    };
  } catch (err: any) {
    return { success: false, error: `Failed to search: ${err.message}` };
  }
}
export async function searchExact(
  term: string,
  limit: number = 50
) {
  try {
    await syncAllDocuments();

    const results = await exactSearchChunks(term, limit);

    if (!results || results.length === 0) {
      return { success: true, results: "NOT_FOUND" };
    }

    return {
      success: true,
      totalFound: results.length,
      results: results.map((r: any) => ({
        title: r.title || "Unknown",
        fileId: r.file_id || null,
        offset: r.offset ?? 0,
        text: r.text,
      })),
    };
  } catch (err: any) {
    return { success: false, error: `Failed to search: ${err.message}` };
  }
}
