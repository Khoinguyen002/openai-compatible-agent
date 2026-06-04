import { ToolCall } from "./tool.js";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContentPart = {
  type: "image_url";
  image_url: {
    url: string; // URL or base64 encoded image data
    detail?: string; // Optional, defaults to "auto"
  };
};

export type ContentPart = TextContent | ImageContentPart;

export type ToolMessage = {
  role: "tool";
  content: string;
  tool_call_id: string;
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
      role: "system" | "developer";
      content: string;
      // If "name" is included, it will be prepended like this
      // for non-OpenAI models: `{name}: {content}`
      name?: string;
    }
  | ToolMessage;
