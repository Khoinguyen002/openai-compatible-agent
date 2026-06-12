#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listDriveFiles, readDriveDocument } from "./tools/driveTools.js";
import {
  saveAgentNote,
  searchKnowledge,
  searchExact,
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
      "Semantic vector search across all accessible Google Drive documents. Automatically syncs latest document changes before searching. Returns relevant Markdown chunks with title and character offset.",
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
  "search_exact",
  {
    description:
      "Exhaustive keyword search across all accessible Google Drive documents using full-text index. " +
      "Unlike search_knowledge (semantic/vector), this finds EVERY chunk containing the exact term — " +
      "ideal for specific identifiers: API paths (/v1/foo/bar), function names, config keys, error codes. " +
      "Case-insensitive. Automatically syncs latest document changes before searching.",
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

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("doc-agent MCP server v1.2.0 running on stdio");
}

run().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
