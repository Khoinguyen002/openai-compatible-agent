import { config } from "@workspace/core";
import { logger } from "@workspace/core";
import { sendLLMRequest } from "./pure-llm.js";
import {
  Message,
  NonStreamingChoice,
  Tool,
  ToolMessage,
  ToolCall,
} from "./types/index.js";

export const callAgent = async ({
  messages,
  tools,
  toolExecutors,
  reqLogger,
  events,
  maxTurns = 10,
  context,
}: {
  messages: Message[] | (() => Promise<Message[]> | Message[]);
  tools: Tool[];
  toolExecutors?: (toolName: string, args: any, context?: any) => Promise<any>;
  reqLogger: ReturnType<typeof logger.child<never>>;
  events?: {
    onChoice?: (choice: NonStreamingChoice["message"]) => Promise<void> | void;
    onToolCallSuccess?: (
      toolCallResults: ToolMessage[],
    ) => Promise<void> | void;
  };
  maxTurns?: number;
  context?: { sessionId: string };
}) => {
  let turn = 0;
  let totalToolCalls = 0;
  const { onChoice, onToolCallSuccess } = events || {};
  let choiceMessage: NonStreamingChoice["message"] | null = null;
  let needsApproval = false;
  let lastFinishReason: string | null = null;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  try {
    while (true) {
      reqLogger.trace({ turn }, "agent loop iteration start");
      turn++;

      if (turn > maxTurns) {
        reqLogger.warn({ maxTurns }, "Maximum turns reached");
        break;
      }

      const currentMessages =
        typeof messages === "function" ? await messages() : messages;

      reqLogger.trace({ messages: currentMessages }, "messages before LLM call");

      const { response: result, durationMs } = await sendLLMRequest({
        messages: currentMessages,
        model: config.MODEL_ID,
        tools,
      });

      const choice = result?.choices?.[0];

      if (!choice) {
        throw new Error("No choices returned from LLM");
      }

      // Surface provider-level errors early with a clear message
      const choiceError = (choice as NonStreamingChoice).error;
      if (choiceError) {
        throw new Error(
          `LLM provider error (${choiceError.code}): ${choiceError.message}`,
        );
      }

      choiceMessage = (result.choices[0] as NonStreamingChoice).message;
      lastFinishReason = (choice as NonStreamingChoice).finish_reason;

      // Accumulate token usage
      if (result.usage) {
        totalPromptTokens += result.usage.prompt_tokens ?? 0;
        totalCompletionTokens += result.usage.completion_tokens ?? 0;
      }

      reqLogger.info(
        {
          turn,
          durationMs,
          model: result.model,
          finish_reason: lastFinishReason,
          usage: result.usage
            ? {
                prompt_tokens: result.usage.prompt_tokens,
                completion_tokens: result.usage.completion_tokens,
                total_tokens: result.usage.total_tokens,
                reasoning_tokens:
                  result.usage.completion_tokens_details?.reasoning_tokens,
              }
            : undefined,
        },
        "LLM call complete",
      );

      reqLogger.trace({ result }, "LLM response received");

      // Some models return finish_reason='stop' with content=null and no tool_calls.
      // Guard here to avoid persisting an empty assistant turn that corrupts future
      // context hydration and triggers the "output must contain text or tool calls" error.
      const hasToolCalls =
        choiceMessage.tool_calls && choiceMessage.tool_calls.length > 0;
      const hasContent =
        choiceMessage.content !== null && choiceMessage.content !== "";

      if (!hasToolCalls && !hasContent) {
        reqLogger.warn(
          { finish_reason: lastFinishReason },
          "LLM returned empty content with no tool calls — skipping persist",
        );
        break;
      }

      // Temporarily disabled approval logic to decouple from mcpManager
      const requiresApproval = false;

      // Annotate each tool call so onChoice can distinguish which ones need approval
      if (choiceMessage.tool_calls) {
        choiceMessage = {
          ...choiceMessage,
          tool_calls: choiceMessage.tool_calls.map((tc) => ({
            ...tc,
            requiresApproval: false, // TODO: App should pass this config later
          })),
        };
      }

      await onChoice?.(choiceMessage);

      if (!hasToolCalls) break;

      reqLogger.trace(
        { toolCalls: choiceMessage.tool_calls },
        "tool calls detected in response",
      );

      if (requiresApproval) {
        reqLogger.info("Tool requires approval. Pausing agent loop.");
        needsApproval = true;
        break;
      }

      const toolResults = await executeToolCalls(
        choiceMessage.tool_calls ?? [],
        reqLogger,
        toolExecutors,
        context
      );
      totalToolCalls += toolResults.length;
      await onToolCallSuccess?.(toolResults);
      reqLogger.trace({ toolResults }, "tool calls successfully executed");
    }
  } catch (err) {
    reqLogger.error({ err }, "OpenRouter call failed");
    throw err;
  }

  reqLogger.info(
    {
      turns: turn,
      totalToolCalls,
      finish_reason: lastFinishReason,
      needsApproval,
      totalUsage: {
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        total_tokens: totalPromptTokens + totalCompletionTokens,
      },
    },
    "agent loop complete",
  );

  return { reply: choiceMessage?.content ?? "", needsApproval };
};

export async function executeToolCalls(
  toolCalls: ToolCall[],
  reqLogger: ReturnType<typeof logger.child<never>>,
  toolExecutors?: (toolName: string, args: any, context?: any) => Promise<any>,
  context?: { sessionId: string }
): Promise<ToolMessage[]> {
  return Promise.all<ToolMessage>(
    toolCalls.map(async (tc) => {
      const toolName = tc.function.name;
      const startedAt = Date.now();
      try {
        let toolArgs = JSON.parse(tc.function.arguments);

        if (typeof toolArgs === "string") {
          try {
            toolArgs = JSON.parse(toolArgs);
          } catch (e) {
            throw new Error(
              `Arguments parsed as string but failed to re-parse to Object: ${toolArgs}`,
            );
          }
        }

        if (typeof toolArgs !== "object" || toolArgs === null) {
          throw new Error(
            `Invalid arguments format. Expected object, got ${typeof toolArgs}`,
          );
        }

        let toolResult;

        if (toolExecutors) {
          toolResult = await toolExecutors(toolName, toolArgs, context);
        } else {
          toolResult = { error: `No tool executor provided for ${toolName}` };
        }

        const durationMs = Date.now() - startedAt;
        reqLogger.info(
          {
            toolName,
            durationMs,
            argsPreview: JSON.stringify(toolArgs).slice(0, 120),
          },
          "tool executed",
        );

        return {
          content: JSON.stringify(toolResult),
          role: "tool",
          tool_call_id: tc.id,
          name: toolName,
        };
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        reqLogger.error(
          { error, toolName, durationMs, toolCall: tc },
          "Tool execution failed",
        );

        return {
          content: error instanceof Error ? error.message : String(error),
          role: "tool",
          tool_call_id: tc.id,
          name: toolName,
        };
      }
    }),
  );
}
