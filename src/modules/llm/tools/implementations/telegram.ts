import { config } from "../../../../config/index.js";
import { logger } from "../../../logger/index.js";

async function sendTelegramMessage(text: string, parseMode?: string) {
  const chatId = config.TELEGRAM_BOT_CHAT_ID;
  const body: Record<string, any> = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  const response = await fetch(
    `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const errData = await response.json();
    return { ok: false, status: response.status, errData };
  }

  return { ok: true };
}

export const telegramTools: Record<string, (args: any) => Promise<any>> = {
  send_telegram_message: async (args: { text?: string; message?: string }) => {
    try {
      const text = args.text || args.message;

      if (!text) {
        return { success: false, error: "No message text provided." };
      }

      // First try with HTML
      let result = await sendTelegramMessage(text, "HTML");

      // If HTML parse fails (400), fall back to plain text
      if (!result.ok && result.status === 400) {
        logger.warn(
          { error: result.errData },
          "HTML parse failed — retrying as plain text",
        );
        result = await sendTelegramMessage(text);
      }

      if (!result.ok) {
        logger.error(
          { chatId: config.TELEGRAM_BOT_CHAT_ID, error: result.errData },
          "Failed to send Telegram message",
        );
        return {
          success: false,
          error: `Telegram API error ${result.status}: ${JSON.stringify(result.errData)}`,
        };
      }

      return {
        success: true,
        message: `Message successfully dispatched to chat ID [${config.TELEGRAM_BOT_CHAT_ID}] via grammY.`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to send Telegram message: ${err.message}`,
      };
    }
  },
};

