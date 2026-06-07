# Skill: Cron Jobs

## What this skill does

Allows the agent to schedule **cron jobs** — automated tasks that run on a defined schedule, executed by the LLM and reported back via Telegram.

## Path Convention

The working directory is always the **project root**. All paths must be prefixed with `workspace/`:
- ✅ `read_file("workspace/skills/cron/guide.md")`
- ❌ `read_file("skills/cron/declaration.json")` ← wrong, missing prefix

## Tool Reference

**⚠️ READ YOUR TOOL DESCRIPTIONS**: For exact parameters and usage, read the schemas for `register_cron`, `delete_extension`, `toggle_extension`, and `list_extensions` provided in your runtime environment. **Do not hallucinate parameters.**

## Cron Execution Model (Prompt-Only)

Crons are **prompt-only**. You submit a natural-language instruction; the runtime executes it on schedule via the agent. No arbitrary JavaScript is accepted.

- The instruction is the **COMMAND** for the LLM when the cron fires. It is NOT the literal text to send. 
- Example: ❌ `"Time to drink water!"` (The LLM will just read this and do nothing).
- Example: ✅ `"Generate a creative water reminder and call send_telegram_message to send it to the user."`
- When a cron fires, the agent runs from the project root and may call any registered tool.
- For scheduled code execution: register a custom tool first (`register_tool`), then write a cron prompt that calls it. This keeps scheduling and execution separate and auditable.

## Modifying an Existing Cron

The system does not have an "update" operation for crons. To modify a cron, you must delete then re-register:

1. Call `delete_extension` with `type: "cron"` and the target name → wait for `{"success":true}`
2. Call `register_cron` with the new parameters → wait for `{"success":true}`
3. Only report success to the user **after both tool calls have completed and returned success**.

> ⚠️ **Do NOT report that a replacement was created until `register_cron` has actually been called and returned `{"success": true}`.** Announcing completion before the tool call is executed is incorrect — the cron will be deleted but the replacement will not exist.

---

> ⚠️ **SAFETY**
>
> - **Zero Proactivity**: NEVER create, edit, or delete crons unless explicitly commanded by the user.
> - **Registry Isolation**: Do NOT manually write to `workspace/skills/cron/declaration.json`. Use `register_cron` / `delete_extension` only.
> - **No Code in Crons**: Cron prompts are natural language only. If you need code execution, use a tool instead.
