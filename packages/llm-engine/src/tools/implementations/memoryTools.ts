import fs from "node:fs/promises";
import path from "node:path";
import { MEMORY_DATA_DIR } from "@workspace/core";

const MAX_SIZE_BYTES = 100 * 1024; // 100 KB
const SCHEMA_VERSION = "memory-v1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryEnvelope {
  $schema: typeof SCHEMA_VERSION;
  namespace: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  data: Record<string, unknown>;
}

interface MemorySummary {
  namespace: string;
  description: string;
  updatedAt: string;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(MEMORY_DATA_DIR, { recursive: true });
}

function namespacePath(namespace: string): string {
  // Prevent path traversal
  const safe = path.basename(namespace);
  if (!safe || safe !== namespace || !/^[a-zA-Z0-9_-]+$/.test(safe)) {
    throw new Error(
      `Invalid namespace name "${namespace}". Use only alphanumeric characters, underscores, or hyphens.`,
    );
  }
  return path.join(MEMORY_DATA_DIR, `${safe}.json`);
}

async function readEnvelope(
  filePath: string,
): Promise<MemoryEnvelope | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as MemoryEnvelope;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/** Recursively deep-merges `patch` into `target`. Arrays are replaced, not merged. */
function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Reads a nested value by dot-notation key (e.g. "preferences.language"). */
function getByDotPath(obj: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === "object") {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

/** Deletes a nested key by dot-notation. Mutates a deep clone. */
function deleteByDotPath(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const parts = key.split(".");
  const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  let cursor: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof cursor[part] !== "object" || cursor[part] === null) return clone;
    cursor = cursor[part] as Record<string, unknown>;
  }
  delete cursor[parts[parts.length - 1]];
  return clone;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export const memoryToolImplementations: Record<
  string,
  (args: any) => Promise<any>
> = {
  /**
   * memory_write — create or update a namespace.
   */
  memory_write: async (args: {
    namespace: string;
    description?: string;
    patch: Record<string, unknown>;
    mode?: "merge" | "replace";
  }) => {
    const { namespace, description, patch, mode = "merge" } = args;
    if (!namespace) throw new Error("namespace is required");
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("patch must be a non-array object");
    }

    await ensureDataDir();
    const filePath = namespacePath(namespace);
    const existing = await readEnvelope(filePath);
    const now = new Date().toISOString();

    if (!existing && !description) {
      throw new Error(
        `description is required when creating a new namespace "${namespace}".`,
      );
    }

    const envelope: MemoryEnvelope = {
      $schema: SCHEMA_VERSION,
      namespace,
      description: description ?? existing!.description,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      data:
        mode === "replace"
          ? patch
          : deepMerge(existing?.data ?? {}, patch),
    };

    const serialized = JSON.stringify(envelope, null, 2);
    if (Buffer.byteLength(serialized, "utf-8") > MAX_SIZE_BYTES) {
      throw new Error(
        `Namespace "${namespace}" would exceed the 100 KB size limit after this write. Reduce the data size.`,
      );
    }

    await fs.writeFile(filePath, serialized, "utf-8");
    return {
      success: true,
      namespace,
      updatedAt: now,
      sizeBytes: Buffer.byteLength(serialized, "utf-8"),
    };
  },

  /**
   * memory_read — read a namespace or a single key.
   */
  memory_read: async (args: { namespace: string; key?: string }) => {
    const { namespace, key } = args;
    if (!namespace) throw new Error("namespace is required");

    await ensureDataDir();
    const filePath = namespacePath(namespace);
    const envelope = await readEnvelope(filePath);

    if (!envelope) {
      return { found: false, namespace };
    }

    if (key) {
      const value = getByDotPath(envelope.data, key);
      return { found: value !== undefined, namespace, key, value };
    }

    return { found: true, ...envelope };
  },

  /**
   * memory_delete — delete a key or the entire namespace file.
   */
  memory_delete: async (args: { namespace: string; key?: string }) => {
    const { namespace, key } = args;
    if (!namespace) throw new Error("namespace is required");

    await ensureDataDir();
    const filePath = namespacePath(namespace);
    const envelope = await readEnvelope(filePath);

    if (!envelope) {
      return { success: false, reason: `Namespace "${namespace}" not found.` };
    }

    if (!key) {
      // Delete the entire namespace file
      await fs.unlink(filePath);
      return { success: true, deleted: "namespace", namespace };
    }

    // Delete a single key
    const updatedData = deleteByDotPath(envelope.data, key);
    const updated: MemoryEnvelope = {
      ...envelope,
      data: updatedData,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
    return { success: true, deleted: "key", namespace, key };
  },

  /**
   * memory_list — list all namespaces with metadata.
   */
  memory_list: async () => {
    await ensureDataDir();

    let files: string[];
    try {
      files = await fs.readdir(MEMORY_DATA_DIR);
    } catch {
      return { namespaces: [] };
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const summaries: MemorySummary[] = [];

    for (const file of jsonFiles) {
      const filePath = path.join(MEMORY_DATA_DIR, file);
      const envelope = await readEnvelope(filePath);
      if (!envelope) continue;
      const stat = await fs.stat(filePath).catch(() => ({ size: 0 }));
      summaries.push({
        namespace: envelope.namespace,
        description: envelope.description,
        updatedAt: envelope.updatedAt,
        sizeBytes: stat.size,
      });
    }

    summaries.sort((a, b) => a.namespace.localeCompare(b.namespace));
    return { namespaces: summaries };
  },
};
