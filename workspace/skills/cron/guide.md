# Skill: Cron Jobs

## What this skill does

Allows the agent to schedule **cron jobs** — automated tasks that run on a defined schedule, executed by the LLM and reported back via Telegram.

## Path Convention

The working directory is always the **project root**. All paths must be prefixed with `workspace/`:
- ✅ `read_file("workspace/skills/cron/guide.md")`
- ❌ `read_file("skills/cron/declaration.json")` ← wrong, missing prefix

## Tools Available

| Tool | Purpose |
|---|---|
| `register_cron` | Create or update a cron job |
| `delete_extension` (type: "cron") | Permanently remove a cron |
| `toggle_extension` (type: "cron") | Enable / disable; scheduler hot-reloads immediately |
| `list_extensions` | List all registered crons and tools |

## Cron Execution Model (Prompt-Only)

Crons are **prompt-only**. You submit a natural-language `prompt`; the runtime stores it in `workspace/skills/cron/declaration.json` and executes it on schedule via the agent. No arbitrary JavaScript is accepted.

- The `prompt` field is the **INSTRUCTION** for the LLM when the cron fires. It is NOT the literal text to send. 
- Example: ❌ `"prompt": "Time to drink water!"` (The LLM will just read this and do nothing).
- Example: ✅ `"prompt": "Generate a creative water reminder and call send_telegram_message to send it to the user."`
- When a cron fires, the agent runs from the project root and may call any registered tool.
- For scheduled code execution: register a custom tool first (`register_tool`), then write a cron `prompt` that calls it. This keeps scheduling and execution separate and auditable.

## Deploying a Cron

```json
{
  "name": "daily_workspace_summary",
  "expression": "0 9 * * *",
  "description": "Generate a daily summary of workspace changes and send to Telegram.",
  "prompt": "Summarize recent changes in the workspace and, if anything notable exists, call send_telegram_message with a concise summary."
}
```

The scheduler hot-reloads automatically after registration. The `active` field defaults to `true` if omitted.

## Enabling / Disabling

```json
{ "type": "cron", "name": "daily_workspace_summary", "active": false }
```

Use `list_extensions` to check the current `active` status of all crons.

## Deleting a Cron

Call `delete_extension` with `type: "cron"` and the target `name`. The server prunes the registry and stops the scheduled task.

---

> ⚠️ **SAFETY**
>
> - **Zero Proactivity**: NEVER create, edit, or delete crons unless explicitly commanded by the user.
> - **Registry Isolation**: Do NOT manually write to `workspace/skills/cron/declaration.json`. Use `register_cron` / `delete_extension` only.
> - **No Code in Crons**: Cron prompts are natural language only. If you need code execution, use a tool instead.

## Modifying an Existing Cron

The MCP does not have an "update" operation. To modify a cron, you must delete then re-register:

1. Call `delete_extension` with `type: "cron"` and the target name → wait for `{"success":true}`
2. Call `register_cron` with the new parameters → wait for `{"success":true}`
3. Only report success to the user **after both tool calls have completed and returned success**.

> ⚠️ **Do NOT report that a replacement was created until `register_cron` has actually been called and returned `{"success": true}`.** Announcing completion before the tool call is executed is incorrect — the cron will be deleted but the replacement will not exist.
