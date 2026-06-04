# Guide: Cron Jobs (`register_cron`)

## Path Convention

**Your working directory is always the project root.** All paths passed to filesystem tools or referenced here are relative to that root. Your files live under `workspace/`, always prefix accordingly:

- ✅ `read_file("workspace/cron/declaration.json")`
- ❌ `read_file("cron/declaration.json")` ← wrong, missing prefix

---

## Cron Execution Model (Prompt-Only)

Crons are **prompt-only**. You submit a natural-language `prompt`; the runtime stores it in `workspace/cron/declaration.json` and executes it on schedule via the agent. No arbitrary JavaScript is accepted or run for crons.

- When a cron fires, the agent runs from the project root (same as normal) and may call any registered tool.
- For scheduled code execution: register a custom tool with `register_tool`, then write a cron `prompt` that calls it. This keeps scheduling and execution separate and auditable.

## Deploying a Cron

Call `register_cron` with:

```json
{
  "name": "daily_workspace_summary",
  "expression": "0 9 * * *",
  "description": "Generate a daily summary of workspace changes and send to Telegram.",
  "prompt": "Summarize recent changes in the workspace and, if anything notable exists, call the tool `send_telegram_message` with a concise summary."
}
```

The scheduler hot-reloads automatically after registration. The `active` field defaults to `true` if omitted.

### Enabling / Disabling a Cron

To pause a cron without deleting it, call `toggle_extension`:

```json
{ "type": "cron", "name": "daily_workspace_summary", "active": false }
```

To re-enable it:

```json
{ "type": "cron", "name": "daily_workspace_summary", "active": true }
```

The scheduler hot-reloads immediately — no restart needed. Use `list_extensions` to check the current `active` status of all crons.

### Deleting a Cron

Call `delete_extension` with `type: "cron"` and the target `name`. The server prunes the registry and stops the scheduled task.

---

> ⚠️ **SAFETY**
>
> - **Zero Proactivity**: NEVER create, edit, or delete crons unless explicitly commanded by the user.
> - **Registry Isolation**: Do NOT manually write to `workspace/cron/declaration.json`. Use `register_cron` / `delete_extension` only.
> - **No Code in Crons**: Cron prompts are natural language only. If you need code execution, use a tool instead.
