import { Bot } from "grammy";
import { extensionToolsImplementations } from "./extension.js";
import fsToolImplementations from "./fsTools.js";
import { tavilyToolImplementations } from "./tavily.js";
import { config } from "../../../../config/index.js";
import { createTelegramTools } from "./telegram.js";

const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

export const toolImplementations: Record<string, (args: any) => Promise<any>> =
  {
    ...tavilyToolImplementations,
    ...fsToolImplementations,
    ...extensionToolsImplementations,
    ...createTelegramTools(bot),
  };
