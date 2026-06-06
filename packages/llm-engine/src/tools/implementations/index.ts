import { extensionImplementations } from "./extensions.js";
import { memoryToolImplementations } from "./memoryTools.js";
import { telegramTools } from "./telegram.js";
export const toolImplementations: Record<string, (args: any, context?: any) => Promise<any>> =
  {
    ...extensionImplementations,
    ...memoryToolImplementations,
    ...telegramTools,
  };
