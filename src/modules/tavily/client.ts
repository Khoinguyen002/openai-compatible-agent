import { tavily, type TavilyClient } from "@tavily/core";
import { config } from "../../config/index.js";

let _client: TavilyClient | null = null;

export function getTavilyClient(): TavilyClient {
  if (!config.TAVILY_API_KEY) {
    throw new Error("Tavily not configured: set TAVILY_API_KEY");
  }
  if (!_client) {
    _client = tavily({ apiKey: config.TAVILY_API_KEY });
  }
  return _client;
}
