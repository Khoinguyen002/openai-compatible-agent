import { z } from "zod";

const schema = z.object({
  DOC_MCP_GOOGLE_CLIENT_EMAIL: z.string().email().optional(),
  DOC_MCP_GOOGLE_PRIVATE_KEY: z.string().optional(),

  // Vector DB
  QDRANT_URL: z.string().url().describe("The URL of your Qdrant instance"),
  QDRANT_API_KEY: z
    .string()
    .optional()
    .describe("API Key for Qdrant Cloud (optional for local)"),

  // Embeddings
  OPENROUTER_API_KEY: z.string().min(1),
  EMBEDDING_MODEL_ID: z
    .string()
    .default("nvidia/llama-nemotron-embed-vl-1b-v2:free"),
  // Max chunk size in Markdown chars — system may use a smaller value if
  // the embedding model's token budget requires it (see ingestFlow.ts)
  MAX_CHUNK_SIZE: z.coerce.number().int().positive().default(3000),
  // Max tokens per embedding API call (for batch packing)
  EMBEDDING_MAX_TOKENS: z.coerce.number().int().positive().default(32000),
  // Max embedding API requests per minute
  EMBEDDING_RPM: z.coerce.number().int().positive().default(40),

  // Vision LLM model ID for image descriptions (optional, skip if not set)
  VISION_MODEL_ID: z.string().optional(),
});

function loadConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `doc-mcp configuration error:\n${missing}\n\nPlease check your environment variables.`
    );
  }
  return result.data;
}

export const config = loadConfig();
