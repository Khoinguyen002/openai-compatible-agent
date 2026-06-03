import { toolDeclarations } from "./declaration.js";
import { getDynamicToolsDeclaration } from "./helpers.js";

const EXTENSION_TOOL_NAMES = new Set([
  "register_tool",
  "register_cron",
  "delete_extension",
]);

export const getTools = async (opts?: { excludeExtensionTools?: boolean }) => {
  const systemTools = toolDeclarations;
  const dynamicTools = await getDynamicToolsDeclaration();
  const all = [...systemTools, ...dynamicTools];

  if (opts?.excludeExtensionTools) {
    return all.filter((t) => !EXTENSION_TOOL_NAMES.has(t.function?.name));
  }

  return all;
};

export * from "./implementations/index.js";
