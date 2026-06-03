import { config } from "../../../../config/index.js";
import { logger } from "../../../logger/index.js";

export const telegramTools: Record<string, (args: any) => Promise<any>> = {
  send_telegram_message: async (args: { text: string }) => {
    try {
      const { text } = args;
      const chatId = config.TELEGRAM_BOT_CHAT_ID;

      const response = await fetch(
        `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: "Markdown",
          }),
        },
      );

      if (!response.ok) {
        const errData = await response.json();
        logger.error(
          { chatId, error: errData },
          `Failed to send Telegram message via direct API call`,
        );
        return {
          success: false,
          error: `Telegram API error ${response.status}: ${JSON.stringify(errData)}`,
        };
      }

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
