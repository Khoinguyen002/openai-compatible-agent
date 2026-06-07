import { McpManager, McpConfigSchema } from "@workspace/core";
import { getBaseTools } from "@workspace/llm-engine";
import { telegramBotToolDeclarations } from "./declaration.js";
import { getDynamicToolsDeclaration } from "./helpers.js";
import mcpConfigRaw from "./mcp-config.json" with { type: "json" };

export const mcpManager = new McpManager();

let initialized = false;

export async function initTools() {
  if (initialized) return;
  await mcpManager.initialize(mcpConfigRaw as McpConfigSchema);
  initialized = true;
}

export const getTools = async () => {
  const systemTools = telegramBotToolDeclarations;
  const dynamicTools = await getDynamicToolsDeclaration();
  const baseTools = getBaseTools();

  return [...baseTools, ...systemTools, ...dynamicTools, ...mcpManager.systemTools];
};

import { telegramTools } from "./telegram.js";
import { extensionImplementations } from "./extensions.js";
import { memoryToolImplementations } from "./memoryTools.js";
import { fsToolImplementations } from "./fsTools.js";
import { executeDynamicTool } from "./helpers.js";

const toolImplementations = {
  ...telegramTools,
  ...extensionImplementations,
  ...memoryToolImplementations,
  ...fsToolImplementations,
};

export async function executeTool(toolName: string, args: any, context?: any) {
  if (toolName in toolImplementations) {
    const executeFn = toolImplementations[toolName as keyof typeof toolImplementations];
    return executeFn(args);
  } else if (mcpManager && mcpManager.hasTool(toolName)) {
    return mcpManager.handleToolCall(toolName, JSON.stringify(args));
  } else {
    return executeDynamicTool(toolName, args);
  }
}

export * from "./telegram.js";
export * from "./extensions.js";
export * from "./memoryTools.js";
export * from "./fsTools.js";
export * from "./helpers.js";
