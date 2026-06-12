# @khoinguyen2002/doc-mcp

An MCP (Model Context Protocol) Server designed to seamlessly integrate Google Drive (specifically Google Docs) with LLM Agents. It provides powerful capabilities to read, chunk, embed, and search Google Docs via semantic vector search and exact keyword matching.

## Features

- **Google Drive Integration**: Fetches and parses Google Docs, automatically converting complex HTML into clean, LLM-friendly Markdown (including multi-tab documents).
- **Vision LLM Support**: Uses an external Vision LLM via OpenRouter to describe images embedded within the documents and replaces them with textual descriptions.
- **Incremental Syncing**: Tracks document states in Qdrant. Only embeds new or modified documents. Deletes stale vectors automatically.
- **Vector Search Engine**: Leverages Qdrant to store semantic chunks and retrieve top matches using dense embeddings.
- **Batch Processing**: Smart chunking of Markdown content, with rate-limited and batch-optimized embedding generation via OpenRouter API.

## Installation

This package is designed to run via Node.js. 

```bash
npm install
npm run build
npm start
```

Or you can run it via `npx` (if published):
```bash
npx @khoinguyen2002/doc-mcp
```

## Environment Variables

Before running the server, you must provide the following environment variables.

### Google Credentials (Service Account)
- `DOC_MCP_GOOGLE_CLIENT_EMAIL`: Service Account email with read access to the target Google Drive.
- `DOC_MCP_GOOGLE_PRIVATE_KEY`: Service Account private key.

### Vector DB (Qdrant)
- `QDRANT_URL`: The URL of your Qdrant instance.
- `QDRANT_API_KEY`: API Key for Qdrant Cloud (optional if running locally without auth).

### Embeddings (OpenRouter)
- `OPENROUTER_API_KEY`: Your OpenRouter API key.
- `EMBEDDING_MODEL_ID`: The model used for embeddings (default: `nvidia/llama-nemotron-embed-vl-1b-v2:free`).
- `MAX_CHUNK_SIZE`: Maximum character limit per chunk (default: `3000`).
- `EMBEDDING_MAX_TOKENS`: Token budget per batch embedding call (default: `32000`).
- `EMBEDDING_RPM`: Rate limit (requests per minute) for embeddings (default: `40`).

### Vision (Optional)
- `VISION_MODEL_ID`: OpenRouter model ID used to generate descriptions for images found in docs. If omitted, fallback alt-text is used.


## MCP Tools Exposed

This server exposes 4 main tools for your LLM agents to interact with your knowledge base:

1. **`list_drive_files`**
   - *Description*: Lists all Google Drive documents accessible to the agent.
   - *Parameters*: `keyword` (optional string) to filter by title.

2. **`read_drive_document`**
   - *Description*: Reads the Markdown content of a specific Google Drive document. Supports pagination.
   - *Parameters*: `fileId` (required), `offset` (optional, default 0), `limit` (optional, default 10000).

3. **`search_knowledge`**
   - *Description*: Performs a semantic vector search across all synced documents. Triggers an auto-sync to ensure the index is up-to-date before searching.
   - *Parameters*: `query` (required string), `topK` (optional, default 3).

4. **`search_exact`**
   - *Description*: Performs an exhaustive exact-keyword search across all synced documents. Ideal for finding specific API paths, error codes, or function names.
   - *Parameters*: `term` (required string), `limit` (optional, default 50).

## Architecture & Workflow

1. **Ingestion**: When a search is requested (or `read_drive_document` is called), the system checks Google Drive for any new or modified files based on the `modifiedTime` stored in Qdrant's metadata collection.
2. **Parsing & Chunking**: If a file is modified, the document is fetched via Google Docs API, converted to a generic HAST tree, processed for images, and converted into clean Markdown. The Markdown is then intelligently chunked into overlapping sections based on headings and max size constraints.
3. **Embedding**: Obsolete chunks are deleted from Qdrant. Unchanged chunks have their offsets updated. New or modified chunks are vectorized in batches via the OpenRouter API.
4. **Storage**: Vectors and metadata (hash, offset, title) are pushed to Qdrant. The document's new sync state is committed to Qdrant's metadata collection.
