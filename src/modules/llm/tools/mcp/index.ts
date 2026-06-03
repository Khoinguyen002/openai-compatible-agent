import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "mcp-server-fetch-typescript"],
});

// 2. Tạo Client kết nối
export const mcpClient = new Client(
  { name: "my-telegram-agent", version: "1.0.0" },
  { capabilities: {} },
);
await mcpClient.connect(transport);
