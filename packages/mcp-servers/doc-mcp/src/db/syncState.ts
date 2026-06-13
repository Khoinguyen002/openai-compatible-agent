import { v5 as uuidv5 } from "uuid";
import {
  getQdrantClient,
  initVectorDB,
  METADATA_COLLECTION,
} from "./vector.js";

const METADATA_NS = "2b671a64-40d5-491e-99b0-da01ff1f3342";

function getSyncPointId(fileId: string): string {
  return uuidv5(`sync:${fileId}`, METADATA_NS);
}


export interface SyncEntry {
  modifiedTime: string;
  blockCount: number;
  title: string;
}

export async function getAllSyncEntries(): Promise<Record<string, SyncEntry>> {
  await initVectorDB();
  const client = getQdrantClient();

  const result: Record<string, SyncEntry> = {};
  let offset: string | number | null | undefined = undefined;

  do {
    const page: { points: any[]; next_page_offset?: string | number | null } = await (client as any).scroll(METADATA_COLLECTION, {
      filter: {
        must: [{ key: "type", match: { value: "sync_state" } }]
      },
      with_payload: true,
      with_vector: false,
      limit: 100,
      ...(offset !== undefined ? { offset } : {}),
    });

    for (const point of page.points) {
      if (point.payload && point.payload.file_id) {
        result[point.payload.file_id as string] = {
          modifiedTime: point.payload.modifiedTime as string,
          blockCount: point.payload.blockCount as number,
          title: point.payload.title as string,
        };
      }
    }
    offset = page.next_page_offset;
  } while (offset != null);

  return result;
}

export async function getSyncEntry(fileId: string): Promise<SyncEntry | null> {
  await initVectorDB();
  const client = getQdrantClient();
  const pointId = getSyncPointId(fileId);

  const results = await client.retrieve(METADATA_COLLECTION, {
    ids: [pointId],
    with_payload: true,
    with_vector: false,
  });

  if (results.length === 0) return null;
  const payload = results[0].payload;
  if (!payload) return null;

  return {
    modifiedTime: payload.modifiedTime as string,
    blockCount: payload.blockCount as number,
    title: payload.title as string,
  };
}

export async function setSyncEntry(
  fileId: string,
  entry: SyncEntry
): Promise<void> {
  await initVectorDB();
  const client = getQdrantClient();
  const pointId = getSyncPointId(fileId);

  await client.upsert(METADATA_COLLECTION, {
    wait: true,
    points: [
      {
        id: pointId,
        vector: [1, 1, 1, 1], // Dummy vector with dim=4, non-zero magnitude
        payload: {
          type: "sync_state",
          file_id: fileId,
          modifiedTime: entry.modifiedTime,
          blockCount: entry.blockCount,
          title: entry.title,
        },
      },
    ],
  });
}

export async function deleteSyncEntry(fileId: string): Promise<void> {
  await initVectorDB();
  const client = getQdrantClient();
  const pointId = getSyncPointId(fileId);

  await client.delete(METADATA_COLLECTION, {
    wait: true,
    points: [pointId],
  });
}
