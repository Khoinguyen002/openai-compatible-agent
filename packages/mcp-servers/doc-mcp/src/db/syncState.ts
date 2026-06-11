import { Redis } from "@upstash/redis";
import { config } from "../config.js";

const HASH_KEY = "doc_sync_state";

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: config.UPSTASH_REDIS_REST_URL,
      token: config.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

export interface SyncEntry {
  modifiedTime: string;
  blockCount: number;
  title: string;
}

export async function getAllSyncEntries(): Promise<Record<string, SyncEntry>> {
  const redis = getRedis();
  const raw = await redis.hgetall(HASH_KEY);
  if (!raw) return {};

  const result: Record<string, SyncEntry> = {};
  for (const [fileId, value] of Object.entries(raw)) {
    if (!value) continue;
    try {
      result[fileId] =
        typeof value === "string"
          ? (JSON.parse(value) as SyncEntry)
          : (value as unknown as SyncEntry);
    } catch {
      // skip malformed entries
    }
  }
  return result;
}

export async function getSyncEntry(fileId: string): Promise<SyncEntry | null> {
  const redis = getRedis();
  const raw = await redis.hget(HASH_KEY, fileId);
  if (!raw) return null;
  try {
    return typeof raw === "string"
      ? (JSON.parse(raw) as SyncEntry)
      : (raw as unknown as SyncEntry);
  } catch {
    return null;
  }
}

export async function setSyncEntry(
  fileId: string,
  entry: SyncEntry
): Promise<void> {
  const redis = getRedis();
  await redis.hset(HASH_KEY, { [fileId]: JSON.stringify(entry) });
}

export async function deleteSyncEntry(fileId: string): Promise<void> {
  const redis = getRedis();
  await redis.hdel(HASH_KEY, fileId);
}

// ─── Image Description Cache ──────────────────────────────────────────────────
// Global hash: md5(imageBinary) → description text
// Deduplicates across docs (same image used in multiple files reuses description)
const IMG_DESC_KEY = "img_desc";

export async function getImageDesc(imageHash: string): Promise<string | null> {
  const redis = getRedis();
  const raw = await redis.hget(IMG_DESC_KEY, imageHash);
  return raw ? String(raw) : null;
}

export async function setImageDesc(
  imageHash: string,
  description: string
): Promise<void> {
  const redis = getRedis();
  await redis.hset(IMG_DESC_KEY, { [imageHash]: description });
}
