import { config } from "../../../config/index.js";
import { logger } from "../../logger/index.js";
import { executeDynamicTool } from "../tools/helpers.js";
import { mcpManager, toolImplementations } from "../tools/index.js";
import { sendLLMRequest } from "./pure-llm.js";
import { Message, NonStreamingChoice, Tool, ToolMessage, ToolCall } from "./type.js";

export const callAgent = async ({
  messages,
  tools,
  reqLogger,
  events,
  maxTurns = 10,
}: {
  messages: Message[] | (() => Promise<Message[]> | Message[]);
  tools: Tool[];
  reqLogger: ReturnType<typeof logger.child<never>>;
  events?: {
    onChoice?: (choice: NonStreamingChoice["message"]) => Promise<void> | void;
    onToolCallSuccess?: (
      toolCallResults: ToolMessage[],
    ) => Promise<void> | void;
  };
  maxTurns?: number;
}) => {
  let turn = 0;
  const { onChoice, onToolCallSuccess } = events || {};
  let choiceMessage: NonStreamingChoice["message"] | null = null;
  let needsApproval = false;

  try {
    while (true) {
      reqLogger.trace({ turn }, "agent loop iteration start");
      turn++;

      if (turn > maxTurns) {
        reqLogger.warn("Maximum turns reached");
        break;
      }
      reqLogger.trace(
        {
          messages:
            typeof messages === "function" ? await messages() : messages,
        },
        "messages before LLM call",
      );
      const result = await sendLLMRequest({
        messages: typeof messages === "function" ? await messages() : messages,
        model: config.MODEL_ID,
        tools,
      });

      reqLogger.trace({ result }, "LLM response received");
      const choice = result?.choices?.[0];

      if (!choice) {
        throw new Error("No choices returned from LLM");
      }

      choiceMessage = (result.choices[0] as NonStreamingChoice).message;
      await onChoice?.(choiceMessage);

      const hasToolCalls =
        choiceMessage.tool_calls && choiceMessage.tool_calls.length > 0;

      if (!hasToolCalls) break;

      reqLogger.trace(
        { toolCalls: choiceMessage.tool_calls },
        "tool calls detected in response",
      );

      const requiresApproval = choiceMessage.tool_calls?.some((tc) =>
        mcpManager.requiresApproval(tc.function.name),
      );

      if (requiresApproval) {
        reqLogger.info("Tool requires approval. Pausing agent loop.");
        needsApproval = true;
        break;
      }

      const toolResults = await executeToolCalls(
        choiceMessage.tool_calls ?? [],
        reqLogger,
      );
      await onToolCallSuccess?.(toolResults);
      reqLogger.trace({ toolResults }, "tool calls successfully executed");
    }
  } catch (err) {
    reqLogger.error({ err }, "OpenRouter call failed");
    throw err;
  }

  return { reply: choiceMessage?.content ?? "", needsApproval };
};

export async function executeToolCalls(
  toolCalls: ToolCall[],
  reqLogger: ReturnType<typeof logger.child<never>>,
): Promise<ToolMessage[]> {
  return Promise.all<ToolMessage>(
    toolCalls.map(async (tc) => {
      try {
        const toolName = tc.function.name;
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

        if (toolName in toolImplementations) {
          const executeFn =
            toolImplementations[toolName as keyof typeof toolImplementations];
          toolResult = await executeFn(toolArgs);
        } else if (mcpManager && mcpManager.hasTool(toolName)) {
          toolResult = await mcpManager.handleToolCall(
            toolName,
            tc.function.arguments,
          );
        } else {
          toolResult = await executeDynamicTool(toolName, toolArgs);
        }

        return {
          content: JSON.stringify(toolResult),
          role: "tool",
          tool_call_id: tc.id,
          name: toolName,
        };
      } catch (error) {
        reqLogger.error(
          { error, toolCall: tc },
          "Error occurred while executing tool call",
        );

        return {
          content: error instanceof Error ? error.message : String(error),
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
        };
      }
    }),
  );
}
