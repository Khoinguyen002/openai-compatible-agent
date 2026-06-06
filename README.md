# OpenRouter Telegram Agent

A stateful, self-evolving AI agent integrated into Telegram via OpenRouter. Built for robustness with session orchestration, rate limiting, persistent structured memory, a skills-based workspace, and a dynamic extension system (tools + cron jobs).

## Core Tech Stack

- **Language**: TypeScript (Node.js >= 20)
- **Bot Framework**: [grammY](https://grammy.dev/) — supports both Webhooks (production) and Long-polling (development)
- **AI / LLM**: OpenRouter API + `@modelcontextprotocol/sdk` (MCP) for dynamic tool integration
- **Search**: Tavily MCP server (web search, extract, crawl, research)
- **File System**: `@modelcontextprotocol/server-filesystem` MCP — full read/write access to `workspace/`
- **Database**: Prisma ORM + `better-sqlite3` (SQLite)
- **Logging & Monitoring**: `pino` / `pino-pretty` for structured logging, `@sentry/node` for production error tracking
- **Validation**: `zod`
- **Scheduling**: `node-cron` for prompt-based cron jobs

## Directory Structure (Monorepo)

```text
apps/
└── telegram-bot/          # Telegram Bot app (entry point, webhooks, telegram logic)
    └── src/
        ├── bot/           # Commands, message handler, chunking
        ├── cron/          # Prompt-based cron scheduler
        ├── export/        # CLI export scripts
        └── gateway/       # Rate limiting, user sync, webhook verification

packages/
├── core/                  # Core utilities (logger, sentry, env config, workspace dirs)
├── db/                    # Prisma client, schema, SQLite db
├── vector-db/             # Local LanceDB + Transformers vector memory system
├── llm-engine/            # LLM Orchestrator, session management, dynamic tools, MCP
└── agents/
    └── doc-agent/         # Specialized agent hooks and tools for documents

workspace/
├── guides/
│   ├── soul.md              # Agent identity, behavior rules, built-in tool reference
│   └── index.md             # Skill guide index
└── skills/
    ├── memory/
    │   ├── guide.md         # Memory skill docs (API, format, naming rules)
    │   └── data/            # Persistent memory namespaces (*.json, gitignored)
    ├── tools/
    │   ├── guide.md         # Custom tool skill docs (JS template, safety rules)
    │   └── implementations/ # Dynamic tool scripts (*.js, registered at runtime)
    └── cron/
        └── guide.md         # Cron skill docs (prompt-only model, safety rules)
```

## Key Features

### Agent Skills System
The agent operates via a **skills-based workspace** under `workspace/skills/`. Each skill is a self-contained directory with a `guide.md` the agent reads on demand:

| Skill | What it does |
|---|---|
| **Memory** | Persistent JSON namespaces (`memory_write/read/delete/list`) — user profiles, rules, cron state, etc. |
| **Tools** | Register custom JS tools at runtime (`register_tool`) — sandboxed Node.js child process execution |
| **Cron** | Schedule prompt-based recurring tasks (`register_cron`) — LLM executes on schedule, notifies via Telegram |

### Structured Memory
Agent-managed persistent storage at `workspace/skills/memory/data/`. Each namespace is a schema-validated JSON file (100 KB limit). A memory index is automatically injected into every system prompt so the agent always knows what's been stored.

### Project & Vector Memory (RAG)
Projects allow users to group multiple ChatSessions. A local LanceDB vector database (`.lancedb`) runs natively with `@xenova/transformers` (`all-MiniLM-L6-v2`) to provide Long-Term Memory. The agent uses `store_project_memory` and `search_project_memory` tools to remember and recall dense project context semantically without overwhelming the LLM context window.

### MCP Integration
Four MCP servers run alongside the agent:
- `tavily-mcp` — web search, content extraction, deep research
- `local-filesystem` — full workspace read/write
- `web-fetch` — direct URL fetching
- `code-runner` — sandboxed code execution (Docker)

### Conversation Export
Export session data to structured JSON files for prompt optimization pipelines:
```bash
npm run export              # Export active session per chat
npm run export -- --all     # Export every session in the DB
npm run export -- --chat <id>  # Export all sessions for a specific chat
```
Output: `exports/session_<uuid>.json` (gitignored)

## How to Run

### 1. Setup environment
```bash
npm run setup
# Or: cp .env.example .env && fill in your keys
```

### 2. Install dependencies
```bash
pnpm install
```

### 3. Database setup
```bash
npm run db:push
npm run db:generate
```

### 4. Development (long-polling, hot-reload)
```bash
npm run dev
```

### 5. Production (webhook mode)
```bash
npm run build
npm run start
```

### Useful commands
```bash
npm run db:studio    # Browse and manage the database via Prisma Studio
npm run typecheck    # Run TypeScript type checking without building
npm run export       # Export conversation data to exports/
```

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `MODEL_ID` | Model to use (e.g. `deepseek/deepseek-r1`) |
| `DATABASE_URL` | SQLite file path (e.g. `file:./dev.db`) |
| `TELEGRAM_WEBHOOK_URL` | Public HTTPS URL for webhook (production only) |
| `IDLE_TIMEOUT_HOURS` | Session idle expiry in hours (default: 24) |
| `MAX_DAILY_REQUESTS_PER_USER` | Daily rate limit per user (default: 100) |
