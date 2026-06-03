import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import mcpConfig from "./mcp-config.json";
import { childLogger } from "../../../logger/index.js";
import { Tool } from "../../orchestrator/type.js";

const log = childLogger({ module: "McpManager" });

interface ServerConfig {
  command: string;
  args: string[];
  requireApproval?: boolean;
}

interface ConfigSchema {
  mcpServers: Record<string, ServerConfig>;
}

export class McpManager {
  // Map for quick lookup: tool_name -> MCP Client instance
  private toolToClientMap = new Map<string, Client>();
  // Set of sensitive tools that require Human-in-the-Loop approval
  private approvalRequiredTools = new Set<string>();
  // Array containing all tool schemas formatted for OpenRouter
  public systemTools: Tool[] = [];

  async initialize() {
    const config: ConfigSchema = mcpConfig;
    const serverEntries = Object.entries(config.mcpServers);

    log.info(
      `[MCP] Detected ${serverEntries.length} servers in configuration.`,
    );

    await Promise.all(
      serverEntries.map(async ([serverName, serverConfig]) => {
        try {
          log.info(`[MCP] Connecting to server: ${serverName}...`);

          const transport = new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args,
          });

          const client = new Client(
            { name: `agent-client-${serverName}`, version: "1.0.0" },
            { capabilities: {} },
          );

          await client.connect(transport);

          // Fetch tool list from this server
          const mcpToolsResponse = await client.listTools();

          for (const tool of mcpToolsResponse.tools) {
            // 1. Register in lookup map
            this.toolToClientMap.set(tool.name, client);

            // 1.5. Check if server requires approval
            if (serverConfig.requireApproval) {
              this.approvalRequiredTools.add(tool.name);
            }

            // 2. Format tool schema for OpenAI/OpenRouter
            this.systemTools.push({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            });
            log.info(
              `   -> Successfully loaded tool: [${tool.name}] from server [${serverName}]`,
            );
          }
        } catch (error: any) {
          log.error(
            { err: error.message },
            `[MCP ERROR] Failed to load server [${serverName}]`,
          );
        }
      }),
    );

    log.info(
      `[MCP] Initialization complete! Total tools loaded: ${this.systemTools.length}.`,
    );
  }

  // Middleware function to route tool calls from Orchestrator to the correct MCP Server
  async handleToolCall(
    toolName: string,
    argumentsString: string,
  ): Promise<string> {
    const client = this.toolToClientMap.get(toolName);
    if (!client) {
      throw new Error(
        `No MCP server found that provides the tool [${toolName}]!`,
      );
    }

    const args = JSON.parse(argumentsString);
    const mcpResult = await client.callTool({
      name: toolName,
      arguments: args,
    });

    // Aggregate text results into a raw string for the LLM
    return (mcpResult.content as any[]).map((c: any) => c.text).join("\n");
  }

  hasTool(toolName: string): boolean {
    return this.toolToClientMap.has(toolName);
  }

  requiresApproval(toolName: string): boolean {
    return this.approvalRequiredTools.has(toolName);
  }
}
