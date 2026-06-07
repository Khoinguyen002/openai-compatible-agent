import { Request, Response } from "./types/index.js";

export interface LLMCallResult {
  response: Response;
  durationMs: number;
}

export const sendLLMRequest = async (request: Request, apiKey: string): Promise<LLMCallResult> => {
  const startedAt = Date.now();
  const url = "https://openrouter.ai/api/v1/chat/completions";

  const httpResponse = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
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
