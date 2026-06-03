# OpenRouter Telegram Agent

A stateful, AI-powered Telegram bot built with the OpenRouter Agent SDK. This codebase is designed for robustness, featuring rate limiting, session orchestration, and multiple integrated tools.

## Core Tech Stack & Libraries

- **Language**: TypeScript (Node.js >= 20)
- **Bot Framework**: [grammY](https://grammy.dev/) - Fast, powerful, and easy to use. Supports both Webhooks (for production) and Long-polling (for development).
- **AI/LLM**: 
  - `@openrouter/agent` for model connection and invocation.
  - `@modelcontextprotocol/sdk` (MCP SDK).
  - `@tavily/core` for search capabilities.
- **Database**: Prisma ORM + `better-sqlite3`. Lightweight yet fully featured.
- **Logging & Monitoring**: 
  - `pino` & `pino-pretty` for structured and beautiful console logging.
  - `@sentry/node` for bug tracking in production.
- **Others**: `zod` for validation, `node-cron` / timers for scheduling, `p-retry` for resilience.

## Directory Structure (`src/`)

- `main.ts`: Application entry point. Initializes Sentry, sets up `fsTools` workspace, schedules background jobs (rate limit reset, idle session cleanup), and starts the bot (via webhook or long-polling).
- `config/`: Configuration management, parsing `.env` files.
- `db/`: Prisma client initialization (`client.ts`). Note: the actual schema is located at the project root (`prisma/`).
- `modules/`: Core domain logic, separated into clean modules:
  - `bot/`: Telegram bot setup, command/message handling, and long text chunking (to bypass Telegram's 4096 character limit).
  - `gateway/`: API Gateway layer handling user synchronization (`userSync.ts`), rate limiting (`rateLimit.ts`), and Webhook verification (`verification.ts`).
  - `llm/`: The AI brain. Contains the orchestrator (model invocation, session handling), tools (e.g., `fsTools`), and session management (`session.ts`).
  - `queue/`: `sessionQueue.ts` handles message queueing to prevent overwhelming the bot when users spam messages.
  - `logger/`, `sentry/`, `tavily/`, `cron/`: Setup and integrations for various services.
- `types/`: Shared TypeScript typings.

## How to Run & Develop

1. **Setup Environment**:
   ```bash
   npm run setup
   # Or manually copy .env.example to .env and fill in your keys
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Database Setup (SQLite)**:
   ```bash
   npm run db:push
   npm run db:generate
   ```

4. **Run Development Mode** (Long-polling, hot-reload):
   ```bash
   npm run dev
   ```

5. **Build & Run Production** (Webhook mode):
   ```bash
   npm run build
   npm run start
   ```

*Note:* Use `npm run db:studio` to view and manage your database graphically.
