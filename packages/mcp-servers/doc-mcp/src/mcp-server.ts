#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  searchDriveDocuments,
  ingestDriveDocument,
} from "./tools/driveTools.js";
import { storeKnowledge, searchKnowledge } from "./tools/knowledgeTools.js";
import { config } from "./config.js";

const DRIVE_FOLDER_ID = config.DOC_MCP_DRIVE_FOLDER_ID;

if (!DRIVE_FOLDER_ID) {
  console.error(
    "Missing DOC_MCP_DRIVE_FOLDER_ID environment variable. The doc-agent requires a target folder ID.",
  );
  process.exit(1);
}

const server = new McpServer({
  name: "doc-agent",
  version: "1.0.0",
});

// Register tools
server.registerTool(
  "search_drive_documents",
  {
    description: "Search for Google Drive documents in the configured folder.",
    inputSchema: {
      keyword: z
        .string()
        .optional()
        .describe("Optional keyword to search for in document titles"),
    },
  },
  async ({ keyword }) => {
    const res = await searchDriveDocuments(keyword);
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
  "ingest_drive_document",
  {
    description:
      "Ingest a specific Google Drive document into vector memory for semantic search.",
    inputSchema: {
      fileId: z.string().describe("The Google Drive file ID to ingest"),
    },
  },
  async ({ fileId }) => {
    const res = await ingestDriveDocument(fileId);
    if (!res.success) {
      return {
        content: [{ type: "text", text: `Error: ${res.error}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: res.message || "Ingested successfully" }],
    };
  },
);

server.registerTool(
  "store_knowledge",
  {
    description: "Store information or notes into the folder's vector memory.",
    inputSchema: {
      content: z.string().describe("The knowledge content to store"),
    },
  },
  async ({ content }) => {
    const res = await storeKnowledge(content);
    if (!res.success) {
      return {
        content: [{ type: "text", text: `Error: ${res.error}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: res.message || "Stored successfully" }],
    };
  },
);

server.registerTool(
  "search_knowledge",
  {
    description:
      "Search the folder's vector memory for relevant context or knowledge.",
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

// Start the server
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("doc-agent MCP server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
