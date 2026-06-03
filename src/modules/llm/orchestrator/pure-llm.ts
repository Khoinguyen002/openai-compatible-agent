import { config } from "../../../config/index.js";
import { Request, Response } from "./type.js";

const url = "https://openrouter.ai/api/v1/chat/completions";
const options = {
  method: "POST",
  headers: {
    Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  },
};

export const sendLLMRequest = async (request: Request) => {
  const response = await fetch(url, {
    ...options,
    body: JSON.stringify(request),
  });

  return (await response.json()) as Response;
};
