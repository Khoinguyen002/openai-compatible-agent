# Guide: Custom Tools (`register_tool`)

## Path Convention

**Your working directory is always the project root.** All paths passed to filesystem tools or referenced here are relative to that root. Your files live under `workspace/`, always prefix accordingly:

- ✅ `read_file("workspace/tools/declaration.json")`
- ❌ `read_file("tools/declaration.json")` ← wrong, missing prefix

---

## Deploying a Custom Tool

Call `register_tool` to add or update a tool. The server writes the script to `workspace/tools/implementations/[name].js` and updates the registry at `workspace/tools/declaration.json`.

### Code Architecture

The `code` parameter must be pure JavaScript. It runs in a sandboxed Node.js child process from the **project root**. Input comes via `process.argv[2]` (base64-encoded JSON). Output must be a single `console.log(JSON.stringify(...))`.

**Template:**

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
