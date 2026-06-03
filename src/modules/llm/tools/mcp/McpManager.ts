import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import mcpConfig from "./mcp-config.json";

interface ServerConfig {
  command: string;
  args: string[];
}

interface ConfigSchema {
  mcpServers: Record<string, ServerConfig>;
}

export class McpManager {
  // Bản đồ để tra cứu nhanh: tool_name -> MCP Client instance sở hữu nó
  private toolToClientMap = new Map<string, Client>();
  // Mảng chứa tất cả các schema tool đã format chuẩn để gửi lên OpenRouter
  public systemTools: any[] = [];

  async initialize() {
    const config: ConfigSchema = mcpConfig;

    console.log(
      `[MCP] Phát hiện ${Object.keys(config.mcpServers).length} server trong cấu hình.`,
    );

    for (const [serverName, serverConfig] of Object.entries(
      config.mcpServers,
    )) {
      try {
        console.log(`[MCP] Đang kết nối tới server: ${serverName}...`);

        const transport = new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args,
        });

        const client = new Client(
          { name: `agent-client-${serverName}`, version: "1.0.0" },
          { capabilities: {} },
        );

        await client.connect(transport);

        // Bú danh sách tool của server này về
        const mcpToolsResponse = await client.listTools();

        for (const tool of mcpToolsResponse.tools) {
          // 1. Đăng ký vào map tra cứu
          this.toolToClientMap.set(tool.name, client);

          // 2. Cấu trúc lại thành mảng format OpenAI/OpenRouter xài được liền
          this.systemTools.push({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          });
          console.log(
            `   -> Đã nạp thành công tool: [${tool.name}] từ server [${serverName}]`,
          );
        }
      } catch (error: any) {
        console.error(
          `[MCP ERROR] Thất bại khi nạp server [${serverName}]:`,
          error.message,
        );
      }
    }
    console.log(
      `[MCP] Hoàn thành! Tổng cộng đã bốc được ${this.systemTools.length} tools gối đầu giường.`,
    );
  }

  // Hàm trung gian nhận lệnh từ Orchestrator rồi bắn cho đúng thằng MCP Server xử lý
  async handleToolCall(
    toolName: string,
    argumentsString: string,
  ): Promise<string> {
    const client = this.toolToClientMap.get(toolName);
    if (!client) {
      throw new Error(
        `Hệ thống không tìm thấy mcp server nào nhận thầu cái tool [${toolName}] này!`,
      );
    }

    const args = JSON.parse(argumentsString);
    const mcpResult = await client.callTool({
      name: toolName,
      arguments: args,
    });

    // Gom kết quả text trả về chuỗi thô để ném cho LLM đọc
    return (mcpResult.content as any[]).map((c: any) => c.text).join("\n");
  }

  hasTool(toolName: string): boolean {
    return this.toolToClientMap.has(toolName);
  }
}
