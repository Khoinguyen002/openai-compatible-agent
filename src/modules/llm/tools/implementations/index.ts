import { extensionToolsImplementations } from "./extension.js";
import fsToolImplementations from "./fsTools.js";
import { telegramTools } from "./telegram.js";

export const toolImplementations: Record<string, (args: any) => Promise<any>> =
  {
    ...fsToolImplementations,
    ...extensionToolsImplementations,
    ...telegramTools,
  };
