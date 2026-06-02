# Guide: Agent Runtime Extensions

This guide outlines the strict rules and templates you must follow when dynamically expanding your runtime capabilities. To guarantee system isolation and prevent data corruption, you are completely restricted from writing directly to configuration registries. You must exclusively interact with the system via automated registration endpoints.

---

## 1. Extension Typologies

You can extend your architecture using two distinct categories of extensions:

1. **Custom Tools**: Synchronous execution blocks triggered on-demand by the user or coordinating models to fetch, transform, or manipulate context.
2. **Cron Jobs**: Asynchronous background tasks scheduled via standard cron expressions to handle automated workflows (e.g., system syncs, automated alerts, time-blocked scraping).

---

## 2. Deploying a Custom Tool (`register_tool`)

To add or modify a tool, call the `register_tool` system endpoint. The server natively updates `./workspace/tools/declaration.json` and compiles the physical script inside `./workspace/tools/implementations/[name].js`.

### Execution Code Architecture

The code parameter must contain pure, production-ready JavaScript (`.js`). It executes in a sandboxed Node.js child process. It must fetch its incoming variables by base64-decoding `process.argv[2]` and pipeline its final outcome strictly via a single stringified JSON `console.log`.

**Custom Tool JavaScript Template:**

```javascript
// 1. Intercept the inbound Base64 argument payload injected by the server
const base64Args = process.argv[2];
if (!base64Args) {
  console.log(
    JSON.stringify({
      error: "Runtime Error: Missing execution payload arguments.",
    }),
  );
  process.exit(1);
}

// 2. Safely decode the payload back into an operational JSON object
const args = JSON.parse(Buffer.from(base64Args, "base64").toString("utf-8"));

async function main() {
  // Extract your mapped parameter keys
  const targetUsername = args.username;

  // Execute business logic (e.g., network queries, computation, data sorting)
  const resultPayload = {
    success: true,
    message: `Successfully processed user data stream for: ${targetUsername}`,
  };

  // 3. CRITICAL: Output ONLY the final stringified JSON payload to stdout
  console.log(JSON.stringify(resultPayload));
}

main().catch((err) => {
  // Always catch bubbles to prevent raw unhandled trace leaks crashing the main runtime
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
```

---

## 3. Deploying a Background Task (`register_cron`)

To orchestrate automated background tasks, invoke the `register_cron` endpoint. The host runner automatically maps the configuration metadata to `./workspace/cron/declaration.json` and triggers hot-reloading on the core scheduling loops.

### Cron Execution Code Architecture

Unlike tools, crons do not accept incoming CLI user arguments because they run autonomously. However, they execute with their current working directory (`cwd`) explicitly pinned to the `workspace` directory. Any filesystem read/write loops written inside the script should utilize path mappings relative to the workspace root.

**Cron Job JavaScript Template:**

```javascript
async function executeTask() {
  // Example background logic: Fetching external telemetry or cleaning temporary logs
  console.log("[CRON EVENT] Initiating routine automation cycle...");

  // Custom execution workflow here...

  console.log("[CRON EVENT] Automation sequence successfully completed.");
}

executeTask().catch((err) => {
  console.error(`[CRON EXCEPTION]: ${err.message}`);
  process.exit(1);
});
```

---

## 4. Modifying and Cleaning Up (`delete_extension`)

If an extension contains breaking bugs, behaves erratically, or needs a structural redesign, do not attempt to strip it down using text utilities. You must purge it gracefully from the running architecture using the dedicated tool:

- **To wipe a tool:** Call `delete_extension` passing `type: "tool"` and the target `name`.
- **To wipe a cron:** Call `delete_extension` passing `type: "cron"` and the target `name`.

The system will automatically prune the JSON arrays and cleanly unlink the file assets from the workspace disk.

---

> ⚠️ **CRITICAL SAFETY WARNING (API COMPLIANCE MANDATE)**
>
> - **Zero Proactivity**: You must NEVER create, edit, or delete any extensions unless explicitly and clearly commanded by the user in the current conversation.
> - **Registry Isolation**: You do not have permission to invoke manual `write_file` routines over `tools/declaration.json` or `cron/declaration.json`. Direct updates to these files bypass validation systems and corrupt the engine state.
> - **Execution Invariant**: Every custom tool file MUST parse arguments from `process.argv[2]` as base64 strings and interface results via JSON stringified stdout. Violating this pattern yields immediate string parsing failure crashes.
