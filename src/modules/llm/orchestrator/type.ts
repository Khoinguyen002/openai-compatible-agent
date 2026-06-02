type ProviderSort =
  | "price"
  | "throughput"
  | "latency"
  | {
      by: "price" | "throughput" | "latency";
      partition?: "model" | "none";
    };

type ProviderPercentileThresholds = {
  p50?: number;
  p75?: number;
  p90?: number;
  p99?: number;
};

type ProviderPriceLimit = {
  prompt?: number;
  completion?: number;
  request?: number;
  image?: number;
};

type ProviderPreferences = {
  order?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: "allow" | "deny";
  zdr?: boolean;
  enforce_distillable_text?: boolean;
  only?: string[];
  ignore?: string[];
  quantizations?: string[];
  sort?: ProviderSort;
  preferred_min_throughput?: number | ProviderPercentileThresholds;
  preferred_max_latency?: number | ProviderPercentileThresholds;
  max_price?: ProviderPriceLimit;
};

// Subtypes:

type TextContent = {
  type: "text";
  text: string;
};

type ImageContentPart = {
  type: "image_url";
  image_url: {
    url: string; // URL or base64 encoded image data
    detail?: string; // Optional, defaults to "auto"
  };
};

type ContentPart = TextContent | ImageContentPart;

export type ToolMessage = {
  role: "tool";
  content: string;
  tool_call_id: string;
  name?: string;
};
export type UserMessage = {
  role: "user";
  // ContentParts are only for the "user" role:
  content: string | ContentPart[];
  name?: string;
};

export type AssistantMessage = {
  role: "assistant";
  // ContentParts are only for the "user" role:
  content?: string;
  name?: string;
  tool_calls?: ToolCall[];
  reasoning?: string;
};
export type Message =
  | UserMessage
  | AssistantMessage
  | {
      role: "system";
      content: string;
      // If "name" is included, it will be prepended like this
      // for non-OpenAI models: `{name}: {content}`
      name?: string;
    }
  | ToolMessage;

type FunctionDescription = {
  description?: string;
  name: string;
  parameters: object; // JSON Schema object
};

export type Tool = {
  type: "function";
  function: FunctionDescription;
};

type ToolChoice =
  | "none"
  | "auto"
  | {
      type: "function";
      function: {
        name: string;
      };
    };

// Response format for structured outputs
type ResponseFormat =
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        strict?: boolean;
        schema: object; // JSON Schema object
      };
    };

// Plugin configuration
type Plugin = {
  id: string; // 'web', 'file-parser', 'response-healing', 'context-compression'
  enabled?: boolean;
  // Additional plugin-specific options
  [key: string]: unknown;
};

// OpenRouter always returns detailed usage information.
// Token counts are calculated using the model's native tokenizer.

type ResponseUsage = {
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

// Subtypes:
type NonChatChoice = {
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

type StreamingChoice = {
  finish_reason: string | null;
  native_finish_reason: string | null;
  delta: {
    content: string | null;
    role?: Message["role"];
    tool_calls?: ToolCall[];
  };
  error?: ErrorResponse;
};

type ErrorResponse = {
  code: number; // See "Error Handling" section
  message: string;
  metadata?: Record<string, unknown>; // Contains additional error information such as provider details, the raw error message, etc.
};

type FunctionCall = {
  name: string;
  arguments: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: FunctionCall;
};

// Definitions of subtypes are below
export type Request = {
  // Either "messages" or "prompt" is required
  messages?: Message[];
  prompt?: string;

  // If "model" is unspecified, uses the user's default
  model?: string; // See "Supported Models" section

  // Allows to force the model to produce specific output format.
  // See "Structured Outputs" section below and models page for which models support it.
  response_format?: ResponseFormat;

  stop?: string | string[];
  stream?: boolean; // Enable streaming

  // Plugins to extend model capabilities (PDF parsing, response healing)
  // See "Plugins" section: openrouter.ai/docs/guides/features/plugins
  plugins?: Plugin[];

  // See LLM Parameters (openrouter.ai/docs/api/reference/parameters)
  max_tokens?: number; // Range: [1, context_length)
  temperature?: number; // Range: [0, 2]

  // Tool calling
  // Will be passed down as-is for providers implementing OpenAI's interface.
  // For providers with custom interfaces, we transform and map the properties.
  // Otherwise, we transform the tools into a YAML template. The model responds with an assistant message.
  // See models supporting tool calling: openrouter.ai/models?supported_parameters=tools
  tools?: Tool[];
  tool_choice?: ToolChoice;

  // Advanced optional parameters
  seed?: number; // Integer only
  top_p?: number; // Range: (0, 1]
  top_k?: number; // Range: [1, Infinity) Not available for OpenAI models
  frequency_penalty?: number; // Range: [-2, 2]
  presence_penalty?: number; // Range: [-2, 2]
  repetition_penalty?: number; // Range: (0, 2]
  logit_bias?: { [key: number]: number };
  top_logprobs?: number; // Integer only
  min_p?: number; // Range: [0, 1]
  top_a?: number; // Range: [0, 1]

  // Reduce latency by providing the model with a predicted output
  // https://platform.openai.com/docs/guides/latency-optimization#use-predicted-outputs
  prediction?: { type: "content"; content: string };

  // OpenRouter-only parameters
  // See "Model Routing" section: openrouter.ai/docs/guides/features/model-routing
  models?: string[];
  route?: "fallback";
  // See "Provider Routing" section: openrouter.ai/docs/guides/routing/provider-selection
  provider?: ProviderPreferences;
  user?: string; // A stable identifier for your end-users. Used to help detect and prevent abuse.

  // Debug options (streaming only)
  debug?: {
    echo_upstream_body?: boolean; // If true, returns the transformed request body sent to the provider
  };
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
