import { Message } from "./message.js";
import { ToolCall } from "./tool.js";

// OpenRouter always returns detailed usage information.
// Token counts are calculated using the model's native tokenizer.

export type ResponseUsage = {
  /** Including images, input audio, and tools if any */
  prompt_tokens: number;
  /** The tokens generated */
  completion_tokens: number;
  /** Sum of the above two fields */
  total_tokens: number;

  /** Breakdown of prompt tokens (optional) */
  prompt_tokens_details?: {
    cached_tokens: number; // Tokens cached by the endpoint
    cache_write_tokens?: number; // Tokens written to cache (models with explicit caching)
    audio_tokens?: number; // Tokens used for input audio
    video_tokens?: number; // Tokens used for input video
  };

  /** Breakdown of completion tokens (optional) */
  completion_tokens_details?: {
    reasoning_tokens?: number; // Tokens generated for reasoning
    audio_tokens?: number; // Tokens generated for audio output
    image_tokens?: number; // Tokens generated for image output
  };

  /** Cost in credits (optional) */
  cost?: number;
  /** Whether request used Bring Your Own Key */
  is_byok?: boolean;
  /** Detailed cost breakdown (optional) */
  cost_details?: {
    upstream_inference_cost?: number; // Only shown for BYOK requests
    upstream_inference_prompt_cost: number;
    upstream_inference_completions_cost: number;
  };

  /** Server-side tool usage (optional) */
  server_tool_use?: {
    web_search_requests?: number;
  };
};

export type NonChatChoice = {
  finish_reason: string | null;
  text: string;
  error?: ErrorResponse;
};

export type NonStreamingChoice = {
  finish_reason: string | null;
  native_finish_reason: string | null;
  message: {
    content: string | null;
    role: "assistant";
    tool_calls?: ToolCall[];
    reasoning?: string;
    reasoning_details?: {
      type: "reasoning.text";
      text: string;
      format: "unknown";
      index: number;
    }[];
  };
  error?: ErrorResponse;
};

export type StreamingChoice = {
  finish_reason: string | null;
  native_finish_reason: string | null;
  delta: {
    content: string | null;
    role?: Message["role"];
    tool_calls?: ToolCall[];
  };
  error?: ErrorResponse;
};

export type ErrorResponse = {
  code: number; // See "Error Handling" section
  message: string;
  metadata?: Record<string, unknown>; // Contains additional error information such as provider details, the raw error message, etc.
};

// Definitions of subtypes are below
export type Response = {
  id: string;
  // Depending on whether you set "stream" to "true" and
  // whether you passed in "messages" or a "prompt", you
  // will get a different output shape
  choices: (NonStreamingChoice | StreamingChoice | NonChatChoice)[];
  created: number; // Unix timestamp
  model: string;
  object: "chat.completion" | "chat.completion.chunk";

  system_fingerprint?: string; // Only present if the provider supports it

  // Usage data is always returned for non-streaming.
  // When streaming, usage is returned exactly once in the final chunk
  // before the [DONE] message, with an empty choices array.
  usage?: ResponseUsage;
};
