import z from "zod";
import { Tool } from "@workspace/llm-engine";

export const telegramBotToolDeclarations = [
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
          developerPrompt: z
            .string()
            .describe(
              "The specific developer prompt instruction that the LLM will execute when this cron triggers. This acts as the direct developer command to perform the scheduled task.",
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
  // -------------------------------------------------------------------------
  // Memory tools
  // -------------------------------------------------------------------------
  {
    type: "function",
    function: {
      name: "memory_write",
      description:
        "Create or update a persistent memory namespace under workspace/skills/memory/data/. " +
        "Read workspace/skills/memory/guide.md before first use.",
      parameters: z
        .object({
          namespace: z
            .string()
            .regex(/^[a-zA-Z0-9_-]+$/)
            .describe("Namespace name (snake_case). Becomes the filename."),
          description: z
            .string()
            .optional()
            .describe(
              "Short description of what this namespace stores. Required when creating a new namespace.",
            ),
          patch: z
            .record(z.string(), z.any())
            .describe("Data to deep-merge into the namespace's data field."),
          mode: z
            .enum(["merge", "replace"])
            .optional()
            .default("merge")
            .describe(
              "merge (default): deep-merge patch into existing data. replace: overwrite data entirely.",
            ),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "memory_read",
      description:
        "Read a memory namespace. Returns full envelope or a single value by dot-notation key.",
      parameters: z
        .object({
          namespace: z.string().describe("Namespace name to read."),
          key: z
            .string()
            .optional()
            .describe(
              "Optional dot-notation path into the data field (e.g. \"preferences.language\"). Omit to read the full namespace.",
            ),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "memory_delete",
      description:
        "Delete a key from a namespace, or the entire namespace file if no key is given.",
      parameters: z
        .object({
          namespace: z.string().describe("Namespace name."),
          key: z
            .string()
            .optional()
            .describe(
              "Dot-notation key to delete from data. Omit to delete the entire namespace.",
            ),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "memory_list",
      description:
        "List all existing memory namespaces with their description, last updated time, and size.",
      parameters: z.object({}).toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "store_project_knowledge",
      description:
        "Store large rules, decisions, context, or knowledge into the active Project's Vector Database. Use this to ensure long-term semantic recall for the current project. Do NOT use this for agent-wide config (use memory_write instead).",
      parameters: z
        .object({
          content: z.string().describe("The detailed content or instruction to remember. Be specific."),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "search_project_knowledge",
      description:
        "Perform a semantic search against the active Project's Vector Database to recall previously stored rules, decisions, or context. ALWAYS use this FIRST when answering project-related questions.",
      parameters: z
        .object({
          query: z.string().describe("The search query. Should be a specific question or keyword to find relevant memory chunks."),
          topK: z.number().optional().describe("Number of results to return. Default is 3."),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "search_drive_tool",
      description:
        "Search Google Drive for documents matching a keyword, or explore all documents if keyword is empty. ONLY use this if search_project_knowledge returns NOT_FOUND, or if you need to discover available documents.",
      parameters: z
        .object({
          keyword: z.string().optional().describe("The name or keyword to search for. Leave empty to explore all available documents."),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "ingest_drive_to_lancedb_tool",
      description:
        "Download a file from Google Drive, split it, embed it, and ingest it into the local LanceDB. MUST be called after finding a relevant fileId from search_drive_tool.",
      parameters: z
        .object({
          fileId: z.string().describe("The Google Drive fileId returned by search_drive_tool."),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories in the workspace.",
      parameters: z
        .object({
          dir: z.string().optional().default(".").describe("Directory to list relative to workspace."),
          recursive: z.boolean().optional().default(false).describe("Whether to list recursively."),
        })
        .toJSONSchema(),
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file in the workspace.",
      parameters: z
        .object({
          filePath: z.string().describe("Path to the file to read relative to workspace."),
          encoding: z.enum(["utf8", "base64"]).optional().default("utf8").describe("Encoding to use."),
        })
        .toJSONSchema(),
    },
  }
] as const satisfies Tool[];
