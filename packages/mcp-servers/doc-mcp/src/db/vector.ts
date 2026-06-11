import { QdrantClient } from "@qdrant/js-client-rest";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import { config } from "../config.js";

let client: QdrantClient | null = null;
const COLLECTION_NAME = "project_memory";

// Fixed namespace for deterministic point IDs (uuid v5)
const POINT_NAMESPACE = "1b671a64-40d5-491e-99b0-da01ff1f3341";

/**
 * Deterministic Qdrant point ID: uuidv5(fileId:blockIndex, NS)
 * Same input → same ID → upsert overwrites correctly.
 */
export function getBlockPointId(fileId: string, blockIndex: number): string {
  return uuidv5(`${fileId}:${blockIndex}`, POINT_NAMESPACE);
}

export async function initVectorDB() {
  if (!client) {
    client = new QdrantClient({
      url: config.QDRANT_URL,
      apiKey: config.QDRANT_API_KEY,
    });
    console.error(`Connected to Qdrant at ${config.QDRANT_URL}`);

    const res = await client.getCollections();
    const exists = res.collections.some((c) => c.name === COLLECTION_NAME);
    if (!exists) {
      console.error(`Creating Qdrant collection: ${COLLECTION_NAME}`);
      const dummyVector = await embedText("test");
      const dimension = dummyVector.length;

      await client.createCollection(COLLECTION_NAME, {
        vectors: { size: dimension, distance: "Cosine" },
      });
      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "source",
        field_schema: "keyword",
      });
      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "file_id",
        field_schema: "keyword",
      });
      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "block_index",
        field_schema: "integer",
      });
      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "block_hash",
        field_schema: "keyword",
      });
      // Full-text index on `text` payload for exact/keyword search.
      // whitespace tokenizer keeps API paths (e.g. /v1/foo/bar) as single tokens.
      // lowercase=true makes searches case-insensitive.
      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "text",
        field_schema: {
          type: "text",
          tokenizer: "whitespace",
          min_token_len: 2,
          max_token_len: 200,
          lowercase: true,
        } as any,
      });
      console.error(
        `Collection ${COLLECTION_NAME} created with dimension ${dimension}.`
      );
    }
  }
}

export async function embedText(
  text: string,
  maxRetries = 5
): Promise<number[]> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.EMBEDDING_MODEL_ID,
          input: text,
        }),
      });

      if (!response.ok) {
        if (response.status === 429 && attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          console.error(
            `[Rate Limit] OpenRouter 429. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt + 1}/${maxRetries})`
          );
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }
        const errText = await response.text();
        throw new Error(
          `OpenRouter Embedding API failed: ${response.status} ${errText}`
        );
      }

      const json: any = await response.json();
      if (!json.data || !json.data[0] || !json.data[0].embedding) {
        throw new Error(
          `Invalid response from OpenRouter: ${JSON.stringify(json)}`
        );
      }
      return json.data[0].embedding;
    } catch (err: any) {
      if (attempt >= maxRetries - 1) throw err;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
      console.error(
        `[Error] ${err.message}. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt + 1}/${maxRetries})`
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw new Error("Max retries reached for embedding");
}

/**
 * Embed nhiều texts trong 1 API call (batch).
 * OpenRouter hỗ trợ input: string[] → trả data[i].embedding.
 */
export async function embedBatch(
  texts: string[],
  maxRetries = 5
): Promise<number[][]> {
  if (texts.length === 0) return [];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.EMBEDDING_MODEL_ID,
          input: texts,
        }),
      });

      if (!response.ok) {
        if (response.status === 429 && attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          console.error(
            `[Rate Limit] OpenRouter 429 (batch). Retrying in ${Math.round(delay)}ms... (Attempt ${attempt + 1}/${maxRetries})`
          );
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }
        const errText = await response.text();
        throw new Error(
          `OpenRouter Batch Embedding API failed: ${response.status} ${errText}`
        );
      }

      const json: any = await response.json();
      if (!json.data || !Array.isArray(json.data)) {
        throw new Error(
          `Invalid batch response from OpenRouter: ${JSON.stringify(json)}`
        );
      }
      return json.data.map((item: any) => item.embedding);
    } catch (err: any) {
      if (attempt >= maxRetries - 1) throw err;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
      console.error(
        `[Error] ${err.message}. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt + 1}/${maxRetries})`
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw new Error("Max retries reached for batch embedding");
}

export interface ChunkUpsert {
  pointId: string;
  vector: number[];
  text: string;
  title: string;
  fileId: string;
  blockIndex: number;
  blockHash: string;
  source: string;
  offset: number; // character offset in the Markdown string
}

/**
 * Bulk upsert nhiều chunks vào Qdrant trong 1 HTTP call.
 */
export async function upsertChunkBatch(chunks: ChunkUpsert[]): Promise<void> {
  await initVectorDB();
  if (!client) throw new Error("Qdrant not initialized");
  if (chunks.length === 0) return;

  await client.upsert(COLLECTION_NAME, {
    wait: true,
    points: chunks.map((c) => ({
      id: c.pointId,
      vector: c.vector,
      payload: {
        text: c.text,
        title: c.title,
        file_id: c.fileId,
        block_index: c.blockIndex,
        block_hash: c.blockHash,
        source: c.source,
        offset: c.offset,
      },
    })),
  });
  console.error(`Upserted ${chunks.length} chunk(s) to Qdrant.`);
}

/**
 * Fetch block_hash AND offset for a list of point IDs.
 * Used to diff block-level changes during re-sync (hash) and
 * detect stale offsets in unchanged blocks (offset).
 */
export async function getBlockMetaByIds(
  pointIds: string[]
): Promise<Record<string, { hash: string; offset: number }>> {
  await initVectorDB();
  if (!client || pointIds.length === 0) return {};

  const results = await client.retrieve(COLLECTION_NAME, {
    ids: pointIds,
    with_payload: ["block_hash", "offset"],
    with_vector: false,
  });

  const metaMap: Record<string, { hash: string; offset: number }> = {};
  for (const point of results) {
    const hash = point.payload?.block_hash as string | undefined;
    const offset = point.payload?.offset as number | undefined;
    if (hash !== undefined) {
      metaMap[point.id as string] = { hash, offset: offset ?? 0 };
    }
  }
  return metaMap;
}

/**
 * Update only the `offset` payload field for a set of points (no re-embedding).
 * Called for unchanged blocks whose character position shifted due to earlier edits.
 * Uses parallel setPayload calls (lightweight metadata-only updates).
 */
export async function updateBlockOffsets(
  updates: { pointId: string; offset: number }[]
): Promise<void> {
  if (updates.length === 0) return;
  await initVectorDB();
  if (!client) throw new Error("Qdrant not initialized");

  await Promise.all(
    updates.map(({ pointId, offset }) =>
      client!.setPayload(COLLECTION_NAME, {
        payload: { offset },
        points: [pointId],
        wait: false, // fire-and-forget per point; all resolve before function returns
      })
    )
  );
  console.error(`[Sync] Updated offset for ${updates.length} unchanged block(s).`);
}

/**
 * Xóa Qdrant points theo danh sách IDs.
 */
export async function deletePointsByIds(pointIds: string[]): Promise<void> {
  await initVectorDB();
  if (!client || pointIds.length === 0) return;

  await client.delete(COLLECTION_NAME, {
    wait: true,
    points: pointIds,
  });
  console.error(`Deleted ${pointIds.length} obsolete block(s) from Qdrant.`);
}

/**
 * Global semantic search — không filter theo folder hay file.
 */
export async function searchProjectMemory(
  query: string,
  topK: number = 3
): Promise<any[]> {
  await initVectorDB();
  if (!client) throw new Error("Qdrant not initialized");

  try {
    const queryVector = await embedText(query);
    const results = await client.search(COLLECTION_NAME, {
      vector: queryVector,
      limit: topK,
      with_payload: true,
    });

    return results.map((r) => ({
      id: r.id,
      ...r.payload,
    }));
  } catch (err: any) {
    console.error("Qdrant search error:", err.message);
    return [];
  }
}

/**
 * Exhaustive substring search: scrolls ALL points and filters client-side.
 * More reliable than Qdrant full-text filter (whitespace tokenizer doesn't
 * strip surrounding punctuation, causing false negatives for terms like
 * "ServiceCode.mkp" appearing as "ServiceCode.mkp)" in headings).
 * For typical collection sizes (~few hundred chunks) the O(N) cost is negligible.
 */
export async function exactSearchChunks(
  term: string,
  limit: number = 50
): Promise<any[]> {
  await initVectorDB();
  if (!client) throw new Error("Qdrant not initialized");

  const lowerTerm = term.toLowerCase();
  const results: any[] = [];
  let offset: string | number | null | undefined = undefined;

  do {
    const page: { points: any[]; next_page_offset?: string | number | null } =
      await (client as any).scroll(COLLECTION_NAME, {
        with_payload: true,
        with_vector: false,
        limit: 100,
        ...(offset !== undefined ? { offset } : {}),
      });

    for (const point of page.points) {
      const text = ((point.payload?.text as string) ?? "").toLowerCase();
      if (text.includes(lowerTerm)) {
        results.push({ id: point.id, ...point.payload });
        if (results.length >= limit) break;
      }
    }
    offset = page.next_page_offset;
  } while (offset != null && results.length < limit);

  return results;
}

/**
 * Upsert agent note với random UUID (không có fileId).
 */
export async function upsertAgentNote(text: string): Promise<void> {
  await initVectorDB();
  if (!client) throw new Error("Qdrant not initialized");

  const vector = await embedText(text);
  await client.upsert(COLLECTION_NAME, {
    wait: true,
    points: [
      {
        id: uuidv4(),
        vector,
        payload: {
          text,
          title: "Agent Note",
          block_index: 0,
          block_hash: "",
          source: "agent",
          offset: 0,
        },
      },
    ],
  });
  console.error("Upserted agent note to Qdrant.");
}
