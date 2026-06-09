# Skill: Cron Jobs

Crons are **prompt-only** scheduled tasks executed by the LLM. 

## Cron Execution Model
You submit a natural-language instruction; the runtime executes it on schedule via the agent.
- The instruction is the **COMMAND** for the LLM when the cron fires.
- You MUST provide this instruction in the `prompt` parameter of `register_cron`.
- Example ❌: `"Time to drink water!"` (The LLM will read this and do nothing).
- Example ✅: `"Generate a creative water reminder and call send_telegram_message to send it."`
- For scheduled code execution: use `register_tool` to create a tool first, then write a cron `prompt` that calls it.

## Modifying an Existing Cron
There is no "update" tool. To edit a cron, you MUST:
1. Call `delete_extension` (`type: "cron"`, `name: "target_name"`)
2. Call `register_cron` with the new parameters.

## ⚠️ SAFETY RULES
- **Zero Proactivity**: NEVER create, edit, or delete crons unless explicitly requested by the user.
- **Use Tools Only**: Do NOT manually edit any json files. Use the provided tools.
- **Follow Tool Schema**: ALWAYS strictly follow the parameter definitions provided in the `register_cron` tool schema when calling it. Do not hallucinate parameters.
