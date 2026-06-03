import path from "path";
import fs from "node:fs/promises";
import { config } from "../../../../config/index.js";
import { childLogger } from "../../../logger/index.js";
import { BASE_WORKSPACE } from "../../../../config/workspace-dirs.js";

const log = childLogger({ module: "fsTools" });

let BASE_WORKSPACE_REAL = "";

export async function initWorkspace(): Promise<void> {
  await fs.mkdir(BASE_WORKSPACE, { recursive: true });
  BASE_WORKSPACE_REAL = await fs.realpath(BASE_WORKSPACE);
  log.info({ base: BASE_WORKSPACE_REAL }, "workspace initialized");
}

async function ensureBaseRealpath() {
  if (!BASE_WORKSPACE_REAL) {
    try {
      BASE_WORKSPACE_REAL = await fs.realpath(BASE_WORKSPACE);
    } catch (err) {
      // If workspace doesn't exist yet, create it and realpath
      await fs.mkdir(BASE_WORKSPACE, { recursive: true });
      BASE_WORKSPACE_REAL = await fs.realpath(BASE_WORKSPACE);
    }
  }
}

export async function safePath(relativeOrAbsolute: string): Promise<string> {
  await ensureBaseRealpath();

  const resolved = path.resolve(BASE_WORKSPACE, relativeOrAbsolute);

  try {
    const real = await fs.realpath(resolved);
    if (!real.startsWith(BASE_WORKSPACE_REAL)) {
      throw new Error(
        "Permission Denied: Operation outside allowed workspace is prohibited.",
      );
    }
    return real;
  } catch (err: any) {
    // If target doesn't exist yet, allow creation only if parent is inside workspace
    if (err && err.code === "ENOENT") {
      const parent = path.dirname(resolved);
      const parentReal = await fs.realpath(parent).catch(() => null);
      if (!parentReal || !parentReal.startsWith(BASE_WORKSPACE_REAL)) {
        throw new Error(
          "Permission Denied: Operation outside allowed workspace is prohibited.",
        );
      }
      return resolved;
    }
    throw err;
  }
}

async function getDirEntries(
  dirRealpath: string,
  recursive = false,
  base = BASE_WORKSPACE_REAL,
) {
  const entries: Array<{
    name: string;
    path: string;
    type: string;
    size: number;
  }> = [];

  const dirents = await fs.readdir(dirRealpath, { withFileTypes: true });
  for (const d of dirents) {
    const childPath = path.join(dirRealpath, d.name);
    let type = "file";
    if (d.isDirectory()) type = "directory";
    if (d.isSymbolicLink()) type = "symlink";
    const stat = await fs.stat(childPath).catch(() => ({ size: 0 }) as any);
    entries.push({
      name: d.name,
      path: path.relative(base, childPath),
      type,
      size: stat.size ?? 0,
    });
    if (recursive && d.isDirectory()) {
      entries.push(...(await getDirEntries(childPath, true, base)));
    }
  }

  return entries;
}

async function getWorkspaceSize(): Promise<number> {
  await ensureBaseRealpath();
  let total = 0;
  async function walk(p: string) {
    const dirents = await fs.readdir(p, { withFileTypes: true });
    for (const d of dirents) {
      const cp = path.join(p, d.name);
      if (d.isDirectory()) {
        await walk(cp);
      } else {
        const st = await fs.stat(cp).catch(() => ({ size: 0 }) as any);
        total += st.size ?? 0;
      }
    }
  }
  await walk(BASE_WORKSPACE_REAL);
  return total;
}

export const fsToolImplementations: Record<
  string,
  (args: any) => Promise<any>
> = {
  list_files: async (opts: any) => {
    const dir = opts?.dir ?? ".";
    const recursive = !!opts?.recursive;

    const target = await safePath(dir);
    const stat = await fs.stat(target).catch(() => null);
    if (!stat || !stat.isDirectory()) throw new Error("Not a directory");

    const entries = await getDirEntries(target, recursive);
    return { path: path.relative(BASE_WORKSPACE_REAL, target), entries };
  },

  read_file: async (opts: any) => {
    const filePath = opts?.filePath || opts?.path;
    const encoding = opts?.encoding ?? "utf8";
    if (!filePath) throw new Error("path is required");

    const target = await safePath(filePath);
    const st = await fs.stat(target).catch(() => null);
    if (!st || !st.isFile()) throw new Error("Not a file");

    if (config.FS_MAX_FILE_BYTES && st.size > config.FS_MAX_FILE_BYTES) {
      throw new Error("File too large to read");
    }

    const data = await fs.readFile(target);
    if (encoding === "utf8")
      return {
        path: path.relative(BASE_WORKSPACE_REAL, target),
        content: data.toString("utf8"),
        size: data.length,
      };
    return {
      path: path.relative(BASE_WORKSPACE_REAL, target),
      content: data.toString("base64"),
      size: data.length,
    };
  },
};

export default fsToolImplementations;
