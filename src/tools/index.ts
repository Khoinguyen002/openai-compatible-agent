import { tool } from "@openrouter/agent";
import { z } from "zod";
import { Tool } from "../orchestrator/type.js";

// export const jinaReaderTool = tool({
//   name: "jina_reader",
//   description: "Extract and read the content of a webpage using Jina AI Reader",

//   inputSchema: z.object({
//     url: z.string().url().describe("The webpage URL to read"),
//   }),

//   execute: async ({ url }) => {
//     const response = await fetch(
//       `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`,
//     );

//     if (!response.ok) {
//       throw new Error(`Failed to fetch content: ${response.status}`);
//     }

//     const content = await response.text();

//     return {
//       url,
//       content,
//     };
//   },
// });
type ToolWithExecute = Tool & {
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export const jinaReaderTool: ToolWithExecute = {
  type: "function",
  function: {
    name: "jina_reader",
    description:
      "Extract and read the content of a webpage using Jina AI Reader",
    parameters: z.object({
      url: z.url().describe("The webpage URL to read"),
    }),
  },
  execute: async ({ url }: any) => {
    const response = await fetch(
      `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`,
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch content: ${response.status}`);
    }

    const content = await response.text();

    return {
      url,
      content,
    };
  },
};

export const registeredTools: ToolWithExecute[] = [
  jinaReaderTool,
  // Add more tools here: web_search, db_query, code_interpreter, etc.
];
