import { Bot } from "grammy";

export const createTelegramTools = (bot: Bot<any>) => {
  return {
    /**
     * SYSTEM TOOL: SEND TELEGRAM MESSAGE (grammY Version)
     */
    send_telegram_message: async (args: {
      chatId: string | number;
      text: string;
    }) => {
      try {
        const { chatId, text } = args;

        // grammY dùng bot.api thay vì bot.telegram
        await bot.api.sendMessage(chatId, text, {
          parse_mode: "Markdown",
        });

        return {
          success: true,
          message: `Message successfully dispatched to chat ID [${chatId}] via grammY.`,
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Failed to send Telegram message: ${err.message}`,
        };
      }
    },
  };
};
