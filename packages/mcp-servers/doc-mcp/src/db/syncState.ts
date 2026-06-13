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

// ─── Distributed Sync Lock ────────────────────────────────────────────────────
// Single point in METADATA_COLLECTION shared across all MCP instances.
// Prevents redundant Drive API calls and concurrent embedding when multiple
// agents are running in parallel.

const LOCK_POINT_ID = uuidv5("sync_lock:global", METADATA_NS);

// Max time a lock can be held before it's considered stale (e.g. instance crashed)
const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes

export interface SyncLock {
  lockInProgress: boolean;
  lockAcquiredAt: string | null;
  lockInstanceId: string | null;
  lastSyncCompletedAt: string | null;
}

export async function getSyncLock(): Promise<SyncLock> {
  await initVectorDB();
  const client = getQdrantClient();

  const results = await client.retrieve(METADATA_COLLECTION, {
    ids: [LOCK_POINT_ID],
    with_payload: true,
    with_vector: false,
  });

  if (results.length === 0 || !results[0].payload) {
    return { lockInProgress: false, lockAcquiredAt: null, lockInstanceId: null, lastSyncCompletedAt: null };
  }

  const p = results[0].payload;
  return {
    lockInProgress: (p.lock_in_progress as boolean) ?? false,
    lockAcquiredAt: (p.lock_acquired_at as string | null) ?? null,
    lockInstanceId: (p.lock_instance_id as string | null) ?? null,
    lastSyncCompletedAt: (p.last_sync_completed_at as string | null) ?? null,
  };
}

export async function writeSyncLock(lock: SyncLock): Promise<void> {
  await initVectorDB();
  const client = getQdrantClient();

  await client.upsert(METADATA_COLLECTION, {
    wait: true,
    points: [{
      id: LOCK_POINT_ID,
      vector: [1, 1, 1, 1],
      payload: {
        type: "sync_lock",
        lock_in_progress: lock.lockInProgress,
        lock_acquired_at: lock.lockAcquiredAt,
        lock_instance_id: lock.lockInstanceId,
        last_sync_completed_at: lock.lastSyncCompletedAt,
      },
    }],
  });
}

/**
 * Try to acquire the distributed sync lock.
 * Returns the instanceId if acquired, null if another instance holds it or TTL not expired.
 */
export async function tryAcquireSyncLock(
  syncIntervalMs: number,
  instanceId: string,
  force = false
): Promise<{ acquired: boolean; reason: string; lastSyncCompletedAt: string | null }> {
  const lock = await getSyncLock();
  const now = Date.now();

  // 1. Check if last sync is still fresh — skip unless forced
  if (!force && lock.lastSyncCompletedAt) {
    const elapsed = now - new Date(lock.lastSyncCompletedAt).getTime();
    if (elapsed < syncIntervalMs) {
      return {
        acquired: false,
        reason: `fresh (last sync ${Math.round(elapsed / 1000)}s ago, TTL ${Math.round(syncIntervalMs / 1000)}s)`,
        lastSyncCompletedAt: lock.lastSyncCompletedAt,
      };
    }
  }

  // 2. Check if another instance is actively syncing (and lock isn't stale)
  // - Normal: skip immediately if another instance holds the lock
  // - force=true: poll up to FORCE_WAIT_TIMEOUT_MS for the lock to be released,
  //   then proceed. This avoids concurrent syncs while ensuring force always runs.
  if (lock.lockInProgress && lock.lockAcquiredAt) {
    const FORCE_WAIT_TIMEOUT_MS = 60_000;
    const POLL_INTERVAL_MS = 2_000;

    let current = lock;
    let waited = 0;

    while (current.lockInProgress) {
      const lockAge = Date.now() - new Date(current.lockAcquiredAt!).getTime();

      if (lockAge >= LOCK_STALE_MS) {
        console.error(`[SyncLock] Stale lock (${Math.round(lockAge / 1000)}s), taking over`);
        break;
      }

      if (!force) {
        return {
          acquired: false,
          reason: `locked by another instance (${Math.round(lockAge / 1000)}s ago)`,
          lastSyncCompletedAt: current.lastSyncCompletedAt,
        };
      }

      // force=true: wait and retry
      if (waited === 0) {
        console.error(`[SyncLock] force=true — waiting for active lock to release (up to ${FORCE_WAIT_TIMEOUT_MS / 1000}s)...`);
      }
      if (waited >= FORCE_WAIT_TIMEOUT_MS) {
        console.error(`[SyncLock] force=true — timeout waiting for lock, taking over`);
        break;
      }

      await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
      waited += POLL_INTERVAL_MS;
      current = await getSyncLock();
    }
  }

  // 3. Write our lock attempt
  await writeSyncLock({
    lockInProgress: true,
    lockAcquiredAt: new Date().toISOString(),
    lockInstanceId: instanceId,
    lastSyncCompletedAt: lock.lastSyncCompletedAt,
  });

  // 4. Short delay then verify we actually won the race
  await new Promise((res) => setTimeout(res, 250));
  const verified = await getSyncLock();

  if (verified.lockInstanceId !== instanceId) {
    return {
      acquired: false,
      reason: "lost lock race to another instance",
      lastSyncCompletedAt: lock.lastSyncCompletedAt,
    };
  }

  return { acquired: true, reason: "acquired", lastSyncCompletedAt: lock.lastSyncCompletedAt };
}

export async function releaseSyncLock(lastSyncCompletedAt: string): Promise<void> {
  await writeSyncLock({
    lockInProgress: false,
    lockAcquiredAt: null,
    lockInstanceId: null,
    lastSyncCompletedAt,
  });
}
