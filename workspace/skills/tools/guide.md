# Skill: Custom Tools

## What this skill does

Allows the agent to register and manage **dynamic tools** — custom JS scripts that run in a sandboxed Node.js child process and persist across sessions.

## Path Convention

The working directory is always the **project root**. All paths must be prefixed with `workspace/`:
- ✅ `read_file("workspace/skills/tools/guide.md")`
- ❌ `read_file("tools/guide.md")` ← wrong, missing prefix

## Tools Available

| Tool | Purpose |
|---|---|
| `register_tool` | Create or update a dynamic tool |
| `delete_extension` (type: "tool") | Permanently remove a tool |
| `toggle_extension` (type: "tool") | Enable or disable without deleting |
| `list_extensions` | List all registered tools and cron jobs |

## Deploying a Custom Tool

Call `register_tool`. The server writes the script to `workspace/skills/tools/implementations/<name>.js` and updates the registry at `workspace/skills/tools/declaration.json`.

### Code Template

The `code` parameter must be **pure JavaScript**. Input arrives via `process.argv[2]` (base64-encoded JSON). Output must be a single `console.log(JSON.stringify(...))`.

```javascript
const base64Args = process.argv[2];
if (!base64Args) {
  console.log(JSON.stringify({ error: "Missing execution payload." }));
  process.exit(1);
}

const args = JSON.parse(Buffer.from(base64Args, "base64").toString("utf-8"));

async function main() {
  // Your logic here — args contains your declared parameters
  const result = { success: true, data: args };
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
```

### Deleting a Tool

Call `delete_extension` with `type: "tool"` and the target `name`. The server removes the script file and prunes the registry.

---

> ⚠️ **SAFETY**
>
> - **Zero Proactivity**: NEVER create, edit, or delete tools unless explicitly commanded by the user.
> - **Registry Isolation**: Do NOT manually write to `workspace/tools/declaration.json`. Use `register_tool` / `delete_extension` only.
> - **Execution Invariant**: Every tool MUST use the `process.argv[2]` base64 input → JSON stdout contract. Violating this crashes the runtime.

## Modifying an Existing Tool

`register_tool` upserts by name — calling it again with the same name replaces the implementation. You do **not** need to delete first unless you want to remove the tool entirely.

To replace a tool's implementation:
1. Call `register_tool` with the same `name` and updated `code`/`parameters` → wait for `{"success":true}`
2. Only report success to the user **after the tool call has completed and returned success**.

> ⚠️ **Do NOT report that a tool was updated or created until `register_tool` has returned `{"success": true}`.** Announcing completion before the tool call executes is incorrect.
