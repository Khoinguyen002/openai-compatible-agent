import z from "zod";
import { Tool } from "../orchestrator/types/index.js";

export const toolDeclarations = [
  {
    type: "function",
    function: {
      name: "tavily_search",
      description:
        "Search the web using Tavily and return LLM-optimized results",
      parameters: z
        .object({
          query: z.string().min(1),
          searchDepth: z
            .enum(["basic", "advanced", "fast", "ultra-fast"])
            .optional(),
          topic: z.enum(["general", "news", "finance"]).optional(),
          maxResults: z.coerce.number().int().min(1).max(20).optional(),
          timeRange: z.enum(["day", "week", "month", "year"]).optional(),
          includeDomains: z.array(z.string()).optional(),
          excludeDomains: z.array(z.string()).optional(),
          includeAnswer: z.boolean().optional(),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "tavily_extract",
      description:
        "Extract clean text/markdown from one or more URLs using Tavily (max 20 URLs)",
      parameters: z
        .object({
          urls: z.array(z.url()).min(1).max(20),
          extractDepth: z.enum(["basic", "advanced"]).optional(),
          format: z.enum(["markdown", "text"]).optional(),
          query: z
            .string()
            .optional()
            .describe(
              "Optional query to rerank extracted content by relevance",
            ),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "tavily_crawl",
      description:
        "Crawl a website starting from a URL and return extracted pages",
      parameters: z
        .object({
          url: z.url(),
          maxDepth: z.coerce.number().int().min(1).optional(),
          maxBreadth: z.coerce.number().int().min(1).optional(),
          limit: z.coerce.number().int().min(1).optional(),
          instructions: z
            .string()
            .optional()
            .describe("Natural language guidance for targeted crawling"),
          selectDomains: z.array(z.string()).optional(),
          excludeDomains: z.array(z.string()).optional(),
          format: z.enum(["markdown", "text"]).optional(),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "tavily_research",
      description:
        "Run an AI-powered deep research job on a topic and return a comprehensive report",
      parameters: z
        .object({
          query: z.string().min(1),
          model: z.enum(["mini", "pro", "auto"]).optional(),
        })
        .toJSONSchema(),
    },
  },

] as const satisfies Tool[];
