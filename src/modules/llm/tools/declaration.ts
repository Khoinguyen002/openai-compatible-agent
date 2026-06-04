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
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories under the workspace",
      parameters: z
        .object({
          dir: z.string().optional().default("."),
          recursive: z.boolean().optional().default(false),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from the workspace (utf8 or base64)",
      parameters: z
        .object({
          path: z.string().min(1),
          encoding: z.enum(["utf8", "base64"]).optional().default("utf8"),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "send_telegram_message",
      description: "Send a message to the configured Telegram chat",
      parameters: z
        .object({
          text: z
            .string()
            .optional()
            .describe("The message content to send to Telegram. Use this or 'message'."),
          message: z
            .string()
            .optional()
            .describe("Alias for 'text'. The message content to send to Telegram."),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "register_tool",
      description:
        "Dynamically register or update a custom runtime tool inside the active workspace.",
      parameters: z
        .object({
          name: z
            .string()
            .regex(/^[a-zA-Z0-9_]+$/)
            .describe("Unique tool name (lowercase and underscores)."),
          description: z.string().describe("What the tool does."),
          parameters: z
            .record(z.string(), z.any())
            .describe("JSON Schema for inputs."),
          code: z.string().describe(
            "Pure JS code execution logic. IMPORTANT: Read workspace/guides/tools.md first for the required template, argument parsing convention, and output format before writing any code.",
          ),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "register_cron",
      description:
        "Schedule a periodic prompt to be executed by the LLM and sent to Telegram.",
      parameters: z
        .object({
          name: z
            .string()
            .regex(/^[a-zA-Z0-9_]+$/)
            .describe(
              "Unique name for the cron job (e.g., 'daily_crypto_report').",
            ),
          expression: z
            .string()
            .describe(
              "Standard cron expression (e.g., '0 9 * * *' for 9 AM daily).",
            ),
          description: z
            .string()
            .describe("Description of what this automated prompt achieves."),
          prompt: z
            .string()
            .describe(
              "The specific instruction prompt that the LLM will execute when this cron triggers.",
            ),
          active: z
            .boolean()
            .optional()
            .default(true)
            .describe("Whether the cron is active. Defaults to true. Set to false to register but not schedule."),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "list_extensions",
      description:
        "Returns the current list of registered dynamic tools and scheduled cron jobs. Use this to check what is already registered before creating or modifying extensions.",
      parameters: z.object({}).toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_extension",
      description:
        "Enable or disable a dynamic tool or cron job without deleting it. For crons, the scheduler hot-reloads immediately.",
      parameters: z
        .object({
          type: z
            .enum(["tool", "cron"])
            .describe("The category of the extension to toggle."),
          name: z.string().describe("The exact name of the extension."),
          active: z
            .boolean()
            .describe("true to enable, false to disable."),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "delete_extension",
      description:
        "Completely uninstall and remove a dynamic extension (tool or cron) from the runtime registry and workspace disk.",
      parameters: z
        .object({
          type: z
            .enum(["tool", "cron"])
            .describe("The category of the extension to be deleted."),
          name: z
            .string()
            .describe(
              "The exact name of the extension to be wiped out from the system.",
            ),
        })
        .toJSONSchema(),
    },
  },
] as const satisfies Tool[];
