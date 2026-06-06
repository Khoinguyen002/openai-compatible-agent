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
      source: metadata.source || "user",
      file_id: metadata.file_id || null,
      modified_time: metadata.modified_time || null,
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

export async function deleteProjectDocument(projectId: string, fileId: string): Promise<void> {
  await initVectorDB();
  if (!db) return;

  const tableNames = await db.tableNames();
  if (!tableNames.includes('project_memory')) return;

  const table = await db.openTable('project_memory');
  await table.delete(`projectId = '${projectId}' AND file_id = '${fileId}'`);
  log.info({ projectId, fileId }, "Deleted old chunks from VectorDB");
}

export async function checkProjectDocumentExists(projectId: string, fileId: string): Promise<boolean> {
  await initVectorDB();
  if (!db) return false;

  const tableNames = await db.tableNames();
  if (!tableNames.includes('project_memory')) return false;

  const table = await db.openTable('project_memory');
  const count = await table.countRows(`projectId = '${projectId}' AND file_id = '${fileId}'`);
  return count > 0;
}

export async function getProjectDocumentMetadata(projectId: string): Promise<Record<string, string>> {
  await initVectorDB();
  if (!db) return {};

  const tableNames = await db.tableNames();
  if (!tableNames.includes('project_memory')) return {};

  const table = await db.openTable('project_memory');
  
  // Try to query distinct file_id and their modified_time. 
  // LanceDB currently doesn't support GROUP BY natively in the JS client for this,
  // so we'll fetch all chunks for the project (only needed columns) and reduce them.
  const records = await table.query()
    .where(`projectId = '${projectId}' AND source = 'google_drive'`)
    .select(['file_id', 'modified_time'])
    .toArray();

  const fileMap: Record<string, string> = {};
  for (const r of records) {
    if (r.file_id && r.modified_time) {
      fileMap[r.file_id as string] = r.modified_time as string;
    }
  }

  return fileMap;
}
