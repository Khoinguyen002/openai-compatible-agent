import { toolDeclarations } from "./declaration.js";
import { getDynamicToolsDeclaration } from "./helpers.js";
import { McpManager } from "./mcp/McpManager.js";

type SystemToolName = (typeof toolDeclarations)[number]["function"]["name"];

export const mcpManager = new McpManager();
await mcpManager.initialize();

export const getTools = async (opts?: { excludedNames: SystemToolName[] }) => {
  const systemTools = toolDeclarations;
  const dynamicTools = await getDynamicToolsDeclaration();

  const all = [...systemTools, ...dynamicTools, ...mcpManager.systemTools];

  if (opts?.excludedNames) {
    return all.filter((t) => !opts.excludedNames.includes(t.function.name));
  }

  return all;
};

export * from "./implementations/index.js";
