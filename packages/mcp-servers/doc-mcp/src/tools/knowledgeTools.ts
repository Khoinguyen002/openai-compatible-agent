import { searchProjectMemory, exactSearchChunks } from "../db/vector.js";
import { searchExactInCache } from "../db/chunkCache.js";

export async function searchKnowledge(query: string, topK: number = 3) {
  try {
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
    // Try in-process cache first (populated by background sync on startup)
    const cached = searchExactInCache(term, limit);

    const raw = cached !== null
      ? cached                                  // cache hit — sub-ms
      : await exactSearchChunks(term, limit);   // fallback: Qdrant scroll

    if (!raw || raw.length === 0) {
      return { success: true, results: "NOT_FOUND" };
    }

    return {
      success: true,
      totalFound: raw.length,
      results: raw.map((r: any) => ({
        title: r.title || "Unknown",
        fileId: r.fileId ?? r.file_id ?? null,
        offset: r.offset ?? 0,
        text: r.text,
      })),
    };
  } catch (err: any) {
    return { success: false, error: `Failed to search: ${err.message}` };
  }
}
