import { connect, Connection } from '@lancedb/lancedb';
import path from 'path';
import { childLogger } from "../logger/index.js";
import { config } from "../../config/index.js";

const log = childLogger({ module: "vector" });

let db: Connection | null = null;

export async function initVectorDB() {
  if (!db) {
    // Connect to LanceDB local instance
    const dbPath = path.resolve(process.cwd(), '.lancedb');
    db = await connect(dbPath);
    log.info(`Connected to LanceDB at ${dbPath}`);
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

export async function upsertProjectDocument(projectId: string, text: string, metadata: Record<string, any> = {}): Promise<void> {
  await initVectorDB();

  if (!db) throw new Error("VectorDB not initialized");

  const vector = await embedText(text);

  const data = [
    {
      id: `${projectId}-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      projectId,
      text,
      vector,
      metadata: JSON.stringify(metadata),
      createdAt: new Date().toISOString()
    }
  ];

  // Open or create the table
  const tableNames = await db.tableNames();
  let table;
  if (tableNames.includes('project_memory')) {
    table = await db.openTable('project_memory');
    await table.add(data);
  } else {
    table = await db.createTable('project_memory', data);
  }

  log.info(`Upserted document for project ${projectId}`);
}

export async function searchProjectMemory(projectId: string, query: string, topK: number = 3): Promise<any[]> {
  await initVectorDB();

  if (!db) throw new Error("VectorDB not initialized");

  const tableNames = await db.tableNames();
  if (!tableNames.includes('project_memory')) {
    return []; // No memory yet
  }

  const table = await db.openTable('project_memory');
  const queryVector = await embedText(query);

  // Search and filter by projectId
  const results = await table
    .search(queryVector)
    .where(`projectId = '${projectId}'`)
    .limit(topK)
    .toArray();

  return results;
}
