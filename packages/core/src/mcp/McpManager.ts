import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { childLogger } from "../logger/index.js";
import { config } from "../config/index.js";
import path from "node:path";

const log = childLogger({ module: "McpManager" });

/**
 * Resolves placeholder tokens in MCP config strings.
 * Supported placeholders:
 *   ${WORKSPACE_DIR} → <cwd>/workspace
 *   ${<ENV_VAR>}     → process.env[ENV_VAR]
 */
function resolvePlaceholders(value: string): string {
  const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");
  return value.replace(/\$\{([^}]+)\}/g, (match, key) => {
    if (key === "WORKSPACE_DIR") return WORKSPACE_DIR;
    const configValue = config[key as keyof typeof config] as string | undefined;
    if (configValue === undefined) {
      log.warn({ placeholder: match }, "MCP config placeholder has no value — keeping as-is");
      return match;
    }
    return configValue;
  });
}

export interface ServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  requireApproval?: boolean;
}

export interface McpConfigSchema {
  mcpServers: Record<string, ServerConfig>;
}

export interface FormattedTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: any;
  };
}

export class McpManager {
  // Map for quick lookup: tool_name -> MCP Client instance
  private toolToClientMap = new Map<string, Client>();
  // Set of sensitive tools that require Human-in-the-Loop approval
  private approvalRequiredTools = new Set<string>();
  // Array containing all tool schemas formatted for OpenRouter
  public systemTools: FormattedTool[] = [];

  async initialize(mcpConfig: McpConfigSchema) {
    const serverEntries = Object.entries(mcpConfig.mcpServers || {});
    const failedServers = new Set<string>();

    await Promise.all(
      serverEntries.map(async ([serverName, serverConfig]) => {
        try {
          const resolvedArgs = serverConfig.args.map(resolvePlaceholders);
          const resolvedEnv = serverConfig.env
            ? Object.fromEntries(
                Object.entries(serverConfig.env).map(([k, v]) => [
                  k,
                  resolvePlaceholders(v),
                ]),
              )
            : undefined;

          const transport = new StdioClientTransport({
            command: serverConfig.command,
            args: resolvedArgs,
            env: resolvedEnv
              ? { ...process.env, ...resolvedEnv } as Record<string, string>
              : undefined,
            stderr: "pipe",
          });

          const client = new Client(
            { name: `agent-client-${serverName}`, version: "1.0.0" },
            { capabilities: {} },
          );

          await client.connect(transport);

          const mcpToolsResponse = await client.listTools();
          const loadedTools: string[] = [];

          for (const tool of mcpToolsResponse.tools) {
            this.toolToClientMap.set(tool.name, client);

            if (serverConfig.requireApproval) {
              this.approvalRequiredTools.add(tool.name);
            }

            this.systemTools.push({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            });

            loadedTools.push(tool.name);
          }

          log.debug(
            { server: serverName, tools: loadedTools },
            "[MCP] Server connected.",
          );
        } catch (error: any) {
          failedServers.add(serverName);
          log.warn(
            { server: serverName, err: error.message },
            "[MCP] Server unavailable — skipping.",
          );
        }
      }),
    );

    const connectedCount = serverEntries.length - failedServers.size;
    log.info(
      {
        tools: this.systemTools.length,
        servers: `${connectedCount}/${serverEntries.length}`,
        ...(failedServers.size > 0 && { failed: [...failedServers] }),
        toolNames: this.systemTools.map((t) => t.function.name),
      },
      "[MCP] Ready.",
    );
  }

  async handleToolCall(toolName: string, argumentsString: string): Promise<string> {
    const client = this.toolToClientMap.get(toolName);
    if (!client) {
      throw new Error(`No MCP server found that provides the tool [${toolName}]!`);
    }

    const args = JSON.parse(argumentsString);
    const mcpResult = await client.callTool({ name: toolName, arguments: args });

    return (mcpResult.content as any[]).map((c: any) => c.text).join("\n");
  }

  hasTool(toolName: string): boolean {
    return this.toolToClientMap.has(toolName);
  }

  requiresApproval(toolName: string): boolean {
    return this.approvalRequiredTools.has(toolName);
  }
}
