import { config } from "../../../config/index.js";
import { Request, Response } from "./types/index.js";

const url = "https://openrouter.ai/api/v1/chat/completions";
const options = {
  method: "POST",
  headers: {
    Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  },
};

export interface LLMCallResult {
  response: Response;
  durationMs: number;
}

export const sendLLMRequest = async (request: Request): Promise<LLMCallResult> => {
  const startedAt = Date.now();

  const httpResponse = await fetch(url, {
    ...options,
    body: JSON.stringify(request),
  });

  if (!httpResponse.ok) {
    let body = "";
    try {
      body = await httpResponse.text();
    } catch {
      body = "(unreadable)";
    }
    throw new Error(
      `LLM HTTP ${httpResponse.status} ${httpResponse.statusText}: ${body.slice(0, 300)}`,
    );
  }

  const response = (await httpResponse.json()) as Response;
  const durationMs = Date.now() - startedAt;

  return { response, durationMs };
};
