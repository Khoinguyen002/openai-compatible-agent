import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';

let client: QdrantClient | null = null;
const COLLECTION_NAME = 'project_memory';

export async function initVectorDB() {
  if (!client) {
    client = new QdrantClient({
      url: config.QDRANT_URL,
      apiKey: config.QDRANT_API_KEY,
    });
    console.error(`Connected to Qdrant at ${config.QDRANT_URL}`);

    // Check if collection exists
    const res = await client.getCollections();
    const exists = res.collections.some(c => c.name === COLLECTION_NAME);
    if (!exists) {
      console.error(`Creating Qdrant collection: ${COLLECTION_NAME}`);
      const dummyVector = await embedText("test");
      const dimension = dummyVector.length;

      await client.createCollection(COLLECTION_NAME, {
        vectors: {
          size: dimension,
          distance: "Cosine",
        },
      });
      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "folderId",
        field_schema: "keyword",
      });
      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "file_id",
        field_schema: "keyword",
      });
      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "source",
        field_schema: "keyword",
      });
      console.error(`Collection ${COLLECTION_NAME} created with dimension ${dimension}.`);
    }
  }
}

export async function embedText(text: string): Promise<number[]> {
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.EMBEDDING_MODEL_ID,
      input: text
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter Embedding API failed: ${response.status} ${errText}`);
  }

  const json: any = await response.json();
  if (!json.data || !json.data[0] || !json.data[0].embedding) {
    throw new Error("Invalid response from OpenRouter Embedding API");
  }

  return json.data[0].embedding;
}

export async function upsertProjectDocument(folderId: string, text: string, metadata: Record<string, any> = {}): Promise<void> {
  await initVectorDB();
  if (!client) throw new Error("Qdrant not initialized");

  const vector = await embedText(text);

  await client.upsert(COLLECTION_NAME, {
    wait: true,
    points: [
      {
        id: uuidv4(),
        vector: vector,
        payload: {
          folderId,
          text,
          source: metadata.source || "user",
          file_id: metadata.file_id || null,
          modified_time: metadata.modified_time || null,
          metadata: JSON.stringify(metadata),
          createdAt: new Date().toISOString()
        }
      }
    ]
  });

  console.error(`Upserted document chunk for folder ${folderId}`);
}

export async function searchProjectMemory(folderId: string, query: string, topK: number = 3): Promise<any[]> {
  await initVectorDB();
  if (!client) throw new Error("Qdrant not initialized");

  try {
    const queryVector = await embedText(query);

    const results = await client.search(COLLECTION_NAME, {
      vector: queryVector,
      limit: topK,
      with_payload: true,
      filter: {
        must: [
          {
            key: "folderId",
            match: {
              value: folderId
            }
          }
        ]
      }
    });

    // Map to match LanceDB format expected by other tools
    return results.map(r => ({
      id: r.id,
      vector: r.vector,
      ...r.payload
    }));
  } catch (err: any) {
    console.error("Qdrant search error:", err.message);
    return [];
  }
}

export async function deleteProjectDocument(folderId: string, fileId: string): Promise<void> {
  await initVectorDB();
  if (!client) return;

  await client.delete(COLLECTION_NAME, {
    filter: {
      must: [
        { key: "folderId", match: { value: folderId } },
        { key: "file_id", match: { value: fileId } }
      ]
    }
  });
  console.error(`Deleted old chunks from Qdrant for ${folderId} / ${fileId}`);
}

export async function checkProjectDocumentExists(folderId: string, fileId: string): Promise<boolean> {
  await initVectorDB();
  if (!client) return false;

  const res = await client.count(COLLECTION_NAME, {
    filter: {
      must: [
        { key: "folderId", match: { value: folderId } },
        { key: "file_id", match: { value: fileId } }
      ]
    }
  });
  return res.count > 0;
}

export async function getProjectDocumentMetadata(folderId: string): Promise<Record<string, string>> {
  await initVectorDB();
  if (!client) return {};

  const res = await client.scroll(COLLECTION_NAME, {
    filter: {
      must: [
        { key: "folderId", match: { value: folderId } },
        { key: "source", match: { value: "google_drive" } }
      ]
    },
    limit: 10000,
    with_payload: ["file_id", "modified_time"],
    with_vector: false
  });

  const fileMap: Record<string, string> = {};
  for (const r of res.points) {
    if (r.payload && r.payload.file_id && r.payload.modified_time) {
      fileMap[r.payload.file_id as string] = r.payload.modified_time as string;
    }
  }

  return fileMap;
}
