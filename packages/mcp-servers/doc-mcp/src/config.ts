import { z } from "zod";

const schema = z.object({
  DOC_MCP_DRIVE_FOLDER_ID: z.string().optional(),
  DOC_MCP_GOOGLE_CLIENT_EMAIL: z.string().email().optional(),
  DOC_MCP_GOOGLE_PRIVATE_KEY: z.string().optional(),
  
  // Vector DB / Embeddings
  OPENROUTER_API_KEY: z.string().min(1),
  EMBEDDING_MODEL_ID: z.string().default("nvidia/llama-nemotron-embed-vl-1b-v2:free"),
  CHUNK_SIZE: z.coerce.number().int().positive().default(4000),
  CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(500),
});

function loadConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration for doc-mcp:\n${missing}`);
  }
  return result.data;
}

export const config = loadConfig();
export type Config = typeof config;
