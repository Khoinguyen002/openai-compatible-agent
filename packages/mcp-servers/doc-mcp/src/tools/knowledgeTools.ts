import crypto from "crypto";
import {
  searchProjectMemory,
  exactSearchChunks,
  embedText,
  COLLECTION_NAME,
  getBlockPointId,
  getQdrantClient,
  initVectorDB
} from "../db/vector.js";
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

export async function contributeDocumentMetadata(
  fileId: string,
  summary: string,
  keywords: string[] = [],
  apis: string[] = []
) {
  try {
    await initVectorDB();
    const client = getQdrantClient();

    const markdownParts = [
      `# Document Metadata (Agent Contributed)`,
      `**Summary**: ${summary}`
    ];
    if (keywords.length > 0) {
      markdownParts.push(`**Keywords**: ${keywords.join(', ')}`);
    }
    if (apis.length > 0) {
      markdownParts.push(`**APIs**: ${apis.join(', ')}`);
    }

    const markdownText = markdownParts.join('\n');
    const embedding = await embedText(markdownText);
    const blockHash = crypto.createHash('md5').update(markdownText).digest('hex');
    const pointId = getBlockPointId(fileId, -1);

    await client.upsert(COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: pointId,
          vector: embedding,
          payload: {
            text: markdownText,
            title: "Agent Contributed Metadata",
            file_id: fileId,
            block_index: -1,
            block_hash: blockHash,
            source: "agent_metadata",
            offset: -1
          }
        }
      ]
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: `Failed to contribute metadata: ${err.message}` };
  }
}
