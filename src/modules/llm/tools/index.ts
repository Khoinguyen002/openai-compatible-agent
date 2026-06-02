import { toolDeclarations } from "./declaration.js";
import { getDynamicToolsDeclaration } from "./helpers.js";

export const getTools = async () => {
  const systemTools = toolDeclarations;
  const dynamicTools = await getDynamicToolsDeclaration();

  return [...systemTools, ...dynamicTools];
};

export * from "./implementations/index.js";
