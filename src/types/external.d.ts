declare module "p-retry";
declare module "ai";
declare module "@openrouter/ai-sdk-provider";

// Broad declaration for the OpenRouter SDK create function
declare module "@openrouter/ai-sdk-provider" {
  export function createOpenRouter(opts: { apiKey: string }): any;
}

export {};
