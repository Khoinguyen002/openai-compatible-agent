#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listDriveFiles, readDriveDocument, syncAllDocuments } from "./tools/driveTools.js";
import { config } from "./config.js";
import { loadCacheFromQdrant, getCacheStats } from "./db/chunkCache.js";
import {
  searchKnowledge,
  searchExact,
  contributeDocumentMetadata,
} from "./tools/knowledgeTools.js";

const server = new McpServer({
  name: "doc-agent",
  version: "1.2.0",
});

server.registerTool(
  "list_drive_files",
  {
    description:
      "List all Google Drive documents accessible to this agent. Returns file IDs, names, and types. Use keyword to filter by title.",
    inputSchema: {
      keyword: z
        .string()
        .optional()
        .describe("Optional keyword to filter documents by title"),
    },
  },
  async ({ keyword }) => {
    const res = await listDriveFiles(keyword);
    if (!res.success) {
      return {
        content: [{ type: "text", text: `Error: ${res.error}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(res.results, null, 2) }],
    };
  },
);

server.registerTool(
  "read_drive_document",
  {
    description:
      "Read the Markdown content of a specific Google Drive document. Automatically syncs the latest version. Use 'offset' (from search_knowledge results) to navigate to a specific section, and 'limit' to control how much content to return.",
    inputSchema: {
      fileId: z.string().describe("The Google Drive file ID to read"),
      offset: z
        .number()
        .optional()
        .describe(
          "Starting character index in the Markdown content (default: 0)",
        ),
      limit: z
        .number()
        .optional()
        .describe("Maximum characters to return (default: 10000)"),
    },
  },
  async ({ fileId, offset, limit }) => {
    const res = await readDriveDocument(fileId, offset, limit);
    if (!res.success) {
      return {
        content: [{ type: "text", text: `Error: ${res.error}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }],
    };
  },
);

server.registerTool(
  "search_knowledge",
  {
    description:
      "Semantic vector search across all accessible Google Drive documents. Automatically syncs latest document changes before searching. Returns relevant Markdown chunks with title and character offset.\n" +
      "CRITICAL AGENT INSTRUCTION: The default topK is only 3. If you are doing comprehensive research, looking for detailed API payloads, or want to ensure you don't miss vital related chunks, you MUST pass a larger topK (e.g. 15 or 20).",
    inputSchema: {
      query: z.string().describe("The search query"),
      topK: z
        .number()
        .optional()
        .describe("Number of results to return (default: 3)"),
    },
  },
  async ({ query, topK }) => {
    const res = await searchKnowledge(query, topK);
    if (!res.success) {
      return {
        content: [{ type: "text", text: `Error: ${res.error}` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text:
            typeof res.results === "string"
              ? res.results
              : JSON.stringify(res.results),
        },
      ],
    };
  },
);

server.registerTool(
  "contribute_document_metadata",
  {
    description:
      "Contribute agent-generated metadata (summary, keywords, APIs) to a Google Drive document. " +
      "This greatly improves semantic search accuracy by injecting an enriched vector chunk. " +
      "Does not modify the original Drive document.\n" +
      "AGENT INSTRUCTION: Proactively call this tool after reading or analyzing any Google Drive document. " +
      "If you spend time understanding a file, summarizing it, or extracting APIs/concepts, crowdsource " +
      "your findings by calling this tool so future agents can find it instantly via vector search.",
    inputSchema: {
      fileId: z.string().describe("The Google Drive file ID"),
      summary: z.string().describe("A concise summary of the document's purpose and contents"),
      keywords: z.array(z.string()).optional().describe("List of relevant keywords, concepts, or terms"),
      apis: z.array(z.string()).optional().describe("List of API endpoints, if any (e.g., /v1/auth)"),
    },
  },
  async ({ fileId, summary, keywords, apis }) => {
    const res = await contributeDocumentMetadata(fileId, summary, keywords, apis);
    if (!res.success) {
      return {
        content: [{ type: "text", text: `Error: ${res.error}` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `Successfully contributed metadata for file ${fileId}.`,
        },
      ],
    };
  },
);

server.registerTool(
  "search_exact",
  {
    description:
      "Exhaustive keyword search across all accessible Google Drive documents using full-text index. " +
      "Unlike search_knowledge (semantic/vector), this finds EVERY chunk containing the exact term — " +
      "ideal for specific identifiers: API paths (/v1/foo/bar), function names, config keys, error codes. " +
      "Case-insensitive.",
    inputSchema: {
      term: z
        .string()
        .describe(
          "Exact term to search for (e.g. '/product-orchestrator/v1/products/filter', 'ServiceCode.mkp')",
        ),
      limit: z
        .number()
        .optional()
        .describe("Max results to return (default: 50)"),
    },
  },
  async ({ term, limit }) => {
    const res = await searchExact(term, limit);
    if (!res.success) {
      return {
        content: [{ type: "text", text: `Error: ${res.error}` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text:
            typeof res.results === "string"
              ? res.results
              : JSON.stringify(res, null, 2),
        },
      ],
    };
  },
);

// ── Shared sync runner (reused by background interval + sync_now tool) ────────
async function runSync({ force = false }: { force?: boolean } = {}): Promise<string> {
  const before = getCacheStats();
  const result = await syncAllDocuments({ force });
  const after = getCacheStats();
  return JSON.stringify({
    ...result,
    cache: {
      fileCount: after.fileCount,
      totalChunks: after.totalChunks,
      estimatedMB: after.estimatedMB,
      chunksDelta: after.totalChunks - before.totalChunks,
    },
  }, null, 2);
}

server.registerTool(
  "sync_now",
  {
    description:
      "Force an immediate sync of all Google Drive documents into Qdrant and the in-process cache. " +
      "Bypasses the normal sync interval TTL. Returns sync result and cache RAM stats.",
    inputSchema: {},
  },
  async () => {
    try {
      const summary = await runSync({ force: true });
      return { content: [{ type: "text", text: summary }] };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
);

async function run() {
  // ── Option B: warm chunk cache from Qdrant before accepting connections ──
  // Ensures search_exact hits in-memory cache from the very first tool call.
  // If Qdrant is unreachable, let the error propagate — better to fail fast
  // and visibly than silently start with an empty cache.
  // The 60s client timeout handles free-tier cold starts gracefully.
  console.error("[ChunkCache] Warming cache from Qdrant...");
  await loadCacheFromQdrant();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const stats = getCacheStats();
  console.error(
    `doc-agent MCP server v1.4.0 running — cache: ${stats.totalChunks} chunks / ${stats.fileCount} files / ~${stats.estimatedMB} MB`
  );

  // ── Background sync scheduler ───────────────────────────────────────────────
  // Syncs Drive changes into Qdrant + updates in-process cache periodically.
  const syncIntervalMs = config.SYNC_INTERVAL_SECONDS * 1000;

  // No initial delay — cache is already warm, first sync runs after one full interval
  const timer = setInterval(
    () => runSync().catch((err) => console.error("[BackgroundSync] Unhandled error:", err.message)),
    syncIntervalMs
  );
  timer.unref();

  console.error(`[BackgroundSync] Scheduled: every ${config.SYNC_INTERVAL_SECONDS}s`);
}

run().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
