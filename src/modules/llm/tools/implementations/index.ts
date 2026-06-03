import { extensionToolsImplementations } from "./extension.js";
import fsToolImplementations from "./fsTools.js";
import { tavilyToolImplementations } from "./tavily.js";
import { telegramTools } from "./telegram.js";

export const toolImplementations: Record<string, (args: any) => Promise<any>> =
  {
    ...tavilyToolImplementations,
    ...fsToolImplementations,
    ...extensionToolsImplementations,
    ...telegramTools,
  };
