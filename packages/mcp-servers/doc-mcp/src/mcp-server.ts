#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  listDriveFiles,
  readDriveDocument,
} from "./tools/driveTools.js";
import { saveAgentNote, searchKnowledge } from "./tools/knowledgeTools.js";
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
  "list_drive_files",
  {
    description: "List and search for Google Drive documents and subfolders in a specific folder.",
    inputSchema: {
      keyword: z
        .string()
        .optional()
        .describe("Optional keyword to search for in document titles"),
      targetFolderId: z
        .string()
        .optional()
        .describe("Optional Google Drive folder ID to list contents from. Defaults to the root knowledge folder."),
    },
  },
  async ({ keyword, targetFolderId }) => {
    const res = await listDriveFiles(keyword, targetFolderId);
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
      "Read the content of a specific Google Drive document. The document will also be automatically ingested into vector memory for future semantic search.",
    inputSchema: {
      fileId: z.string().describe("The Google Drive file ID to read"),
      offset: z.number().optional().describe("Starting character index (default: 0)"),
      limit: z.number().optional().describe("Maximum number of characters to return (default: 10000)"),
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
  "save_agent_note",
  {
    description: "Save an agent note, thought, or summary directly into the vector memory.",
    inputSchema: {
      content: z.string().describe("The note or knowledge content to store"),
    },
  },
  async ({ content }) => {
    const res = await saveAgentNote(content);
    if (!res.success) {
      return {
        content: [{ type: "text", text: `Error: ${res.error}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: res.message || "Saved successfully" }],
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
