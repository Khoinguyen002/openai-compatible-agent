import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  searchDriveDocuments,
  ingestDriveDocument,
} from "./tools/driveTools.js";
import { storeKnowledge, searchKnowledge } from "./tools/knowledgeTools.js";

// Ensure environment variables are set
const API_KEY = process.env.API_KEY;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

if (!API_KEY) {
  console.error(
    "Missing API_KEY environment variable. The MCP server requires an API key for protection.",
  );
  process.exit(1);
}

if (!DRIVE_FOLDER_ID) {
  console.error(
    "Missing DRIVE_FOLDER_ID environment variable. The doc-agent requires a target folder ID.",
  );
  process.exit(1);
}

const server = new McpServer({
  name: "doc-agent",
  version: "1.0.0",
});

// Register tools
server.tool(
  "search_drive_documents",
  "Search for Google Drive documents in the configured folder.",
  {
    keyword: z
      .string()
      .optional()
      .describe("Optional keyword to search for in document titles"),
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

server.tool(
  "ingest_drive_document",
  "Ingest a specific Google Drive document into vector memory for semantic search.",
  {
    fileId: z.string().describe("The Google Drive file ID to ingest"),
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

server.tool(
  "store_knowledge",
  "Store information or notes into the folder's vector memory.",
  {
    content: z.string().describe("The knowledge content to store"),
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

server.tool(
  "search_knowledge",
  "Search the folder's vector memory for relevant context or knowledge.",
  {
    query: z.string().describe("The search query"),
    topK: z
      .number()
      .optional()
      .describe("Number of results to return (default: 3)"),
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
