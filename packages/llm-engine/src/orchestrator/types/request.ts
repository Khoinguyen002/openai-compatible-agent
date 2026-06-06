import { Message } from "./message.js";
import { Tool, ToolChoice } from "./tool.js";
import { Plugin } from "./plugin.js";
import { ProviderPreferences } from "./provider.js";

// Response format for structured outputs
export type ResponseFormat =
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        strict?: boolean;
        schema: object; // JSON Schema object
      };
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
