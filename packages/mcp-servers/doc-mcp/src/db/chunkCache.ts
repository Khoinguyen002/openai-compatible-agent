import { getQdrantClient, initVectorDB, COLLECTION_NAME } from "./vector.js";

export interface CachedChunk {
  text: string;
  normalizedText: string; // pre-computed: backslash escapes stripped + lowercased
  title: string;
  fileId: string;
  blockIndex: number;
  offset: number;
}

// fileId → ordered array of chunks
const cache = new Map<string, CachedChunk[]>();

function normalizeText(text: string): string {
  // Strip Markdown backslash escapes (e.g. \_ → _, \* → *) then lowercase
  return text.replace(/\\(.)/g, "$1").toLowerCase();
}

/**
 * Replace all cached chunks for a file.
 * Called by syncSingleDocument after embedding + upsert.
 */
export function updateFileChunks(
  fileId: string,
  chunks: Array<{ text: string; title: string; blockIndex: number; offset: number }>
): void {
  const cached: CachedChunk[] = chunks.map((c) => ({
    text: c.text,
    normalizedText: normalizeText(c.text),
    title: c.title,
    fileId,
    blockIndex: c.blockIndex,
    offset: c.offset,
  }));
  cache.set(fileId, cached);
}

/**
 * Remove a file's chunks from cache.
 * Called when a doc is deleted from Drive.
 */
export function removeFileChunks(fileId: string): void {
  cache.delete(fileId);
}

/**
 * Fast O(N) in-memory substring search across all cached chunks.
 * Normalizedtext already has MD escapes stripped, so `access_token` matches `access\_token`.
 * Returns null only if cache has never been loaded (fallback to Qdrant).
 */
export function searchExactInCache(term: string, limit: number): CachedChunk[] | null {
  // Cache is considered uninitialized only before loadCacheFromQdrant() has run.
  // After that, cache.size may legitimately be 0 (empty collection) but is still valid.
  if (!cacheInitialized) return null;

  const lowerTerm = term.toLowerCase();
  const results: CachedChunk[] = [];

  for (const chunks of cache.values()) {
    for (const chunk of chunks) {
      if (chunk.normalizedText.includes(lowerTerm)) {
        results.push(chunk);
        if (results.length >= limit) return results;
      }
    }
  }

  return results;
}

let cacheInitialized = false;

/**
 * Warm the in-process cache by scrolling all existing chunks from Qdrant.
 * Call this ONCE on startup, before accepting MCP connections (Option B).
 */
export async function loadCacheFromQdrant(): Promise<void> {
  await initVectorDB();
  const client = getQdrantClient();

  const fileChunks = new Map<
    string,
    Array<{ text: string; title: string; blockIndex: number; offset: number }>
  >();

  let offset: string | number | null | undefined = undefined;
  let totalChunks = 0;

  do {
    const page: { points: any[]; next_page_offset?: string | number | null } =
      await (client as any).scroll(COLLECTION_NAME, {
        with_payload: true,
        with_vector: false,
        limit: 100,
        ...(offset !== undefined ? { offset } : {}),
      });

    for (const point of page.points) {
      const p = point.payload;
      if (!p?.file_id || !p?.text) continue;

      const fileId = p.file_id as string;
      if (!fileChunks.has(fileId)) fileChunks.set(fileId, []);
      fileChunks.get(fileId)!.push({
        text: p.text as string,
        title: (p.title as string) ?? "Untitled",
        blockIndex: (p.block_index as number) ?? 0,
        offset: (p.offset as number) ?? 0,
      });
      totalChunks++;
    }

    offset = page.next_page_offset;
  } while (offset != null);

  // Sort each file's chunks by blockIndex, then populate cache
  for (const [fileId, chunks] of fileChunks) {
    chunks.sort((a, b) => a.blockIndex - b.blockIndex);
    updateFileChunks(fileId, chunks);
  }

  cacheInitialized = true;
  console.error(
    `[ChunkCache] Warmed: ${totalChunks} chunks across ${fileChunks.size} files`
  );
}

/**
 * Returns cache stats including estimated RAM usage.
 * Each JS string is UTF-16 (2 bytes/char). We account for both
 * `text` and `normalizedText` since they are separate string copies.
 */
export function getCacheStats(): {
  initialized: boolean;
  fileCount: number;
  totalChunks: number;
  estimatedBytes: number;
  estimatedMB: string;
} {
  let totalChunks = 0;
  let estimatedBytes = 0;

  for (const chunks of cache.values()) {
    totalChunks += chunks.length;
    for (const chunk of chunks) {
      // text + normalizedText (both UTF-16 = 2 bytes/char)
      estimatedBytes += (chunk.text.length + chunk.normalizedText.length) * 2;
      // fixed overhead per object: title, fileId strings + numeric fields + JS object
      estimatedBytes += (chunk.title.length + chunk.fileId.length) * 2 + 64;
    }
  }

  return {
    initialized: cacheInitialized,
    fileCount: cache.size,
    totalChunks,
    estimatedBytes,
    estimatedMB: (estimatedBytes / 1024 / 1024).toFixed(2),
  };
}

/**
 * Reconstruct document content for a given (offset, limit) window
 * directly from the chunk cache — no Drive API call needed.
 *
 * Works because chunkMarkdown() splits without overlap:
 *   chunks.join("") === original markdown (exact character positions preserved)
 *
 * Returns null if the file is not in cache (cold start / not yet synced).
 */
export function readFromChunkCache(
  fileId: string,
  offset: number,
  limit: number
): { content: string; totalSize: number; title: string } | null {
  const chunks = cache.get(fileId);
  if (!chunks || chunks.length === 0) return null;

  // Total doc size = last chunk's end position
  const lastChunk = chunks[chunks.length - 1];
  const totalSize = lastChunk.offset + lastChunk.text.length;
  const title = chunks[0]?.title ?? "Untitled";

  if (offset >= totalSize) {
    return { content: "", totalSize, title };
  }

  const end = offset + limit;

  // Find chunks that overlap the requested window [offset, end)
  const relevant = chunks.filter((c) => {
    const chunkEnd = c.offset + c.text.length;
    return chunkEnd > offset && c.offset < end;
  });

  if (relevant.length === 0) {
    return { content: "", totalSize, title };
  }

  // Concatenate relevant chunks (no overlap → safe to just join)
  const firstOffset = relevant[0].offset;
  const joined = relevant.map((c) => c.text).join("");

  // Slice to exact requested window
  const startInJoined = offset - firstOffset;
  const sliced = joined.substring(startInJoined, startInJoined + limit);

  return { content: sliced, totalSize, title };
}
