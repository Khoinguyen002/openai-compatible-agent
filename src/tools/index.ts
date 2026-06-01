import { tool } from "@openrouter/agent";
import { z } from "zod";

export const jinaReaderTool = tool({
  name: "jina_reader",
  description: "Extract and read the content of a webpage using Jina AI Reader",

  inputSchema: z.object({
    url: z.string().url().describe("The webpage URL to read"),
  }),

  execute: async ({ url }) => {
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
});

export const registeredTools = [
  jinaReaderTool,
  // Add more tools here: web_search, db_query, code_interpreter, etc.
];
