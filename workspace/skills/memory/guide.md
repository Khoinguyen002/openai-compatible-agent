# Skill: Structured Memory

## What this skill does

Allows the agent to store **persistent data** as JSON — user info, preferences, cron state, notes, rules, etc. — organized into separate named "namespaces". Data persists across sessions.

This is **Structured Memory**, distinct from Semantic Memory (vector DB — to be built later). Structured Memory is for small, well-defined data that needs frequent read/write access.

## Tools Available

| Tool | Purpose |
|---|---|
| `memory_write` | Create or update a namespace |
| `memory_read` | Read an entire namespace or a specific key |
| `memory_delete` | Delete a key or an entire namespace |
| `memory_list` | List all existing namespaces |

## Namespace Format (Required)

Each namespace is a JSON file at `workspace/skills/memory/data/<namespace>.json`. The runtime **enforces** the following wrapper schema:

```json
{
  "$schema": "memory-v1",
  "namespace": "namespace_name",
  "description": "Brief description: what this namespace stores and why it exists",
  "createdAt": "2026-06-05T10:00:00.000Z",
  "updatedAt": "2026-06-05T10:00:00.000Z",
  "data": {
    // free-form object — define your own structure inside
  }
}
```

- `description` is **required** when creating a new namespace
- `data` holds the actual payload — no constraints on internal structure
- `createdAt` and `updatedAt` are managed by the runtime; do not pass them in

## Naming Convention

- Use `snake_case`
- Be descriptive of the domain: `user_profile`, `daily_report_state`, `project_tracker`, `behavior_rules`
- Avoid generic names: ❌ `data`, `info`, `misc`

## API

### `memory_write`

```json
{
  "namespace": "user_profile",
  "description": "Personal info and preferences of the primary user",
  "patch": {
    "name": "Alice",
    "timezone": "Asia/Ho_Chi_Minh"
  },
  "mode": "merge"
}
```

- `patch`: object to deep-merge into the `data` field
- `mode`: `"merge"` (default) — deep-merge | `"replace"` — overwrite `data` entirely
- `description`: required on first write, optional on subsequent updates

### `memory_read`

```json
{ "namespace": "user_profile" }
```

Or read a specific key using dot-notation:

```json
{ "namespace": "user_profile", "key": "preferences.language" }
```

### `memory_delete`

Delete a single key:

```json
{ "namespace": "user_profile", "key": "oldField" }
```

Delete the entire namespace:

```json
{ "namespace": "user_profile" }
```

### `memory_list`

```json
{}
```

Returns: `[{ namespace, description, updatedAt, sizeBytes }]`

## When to use memory

- User shares personal info → `memory_write` immediately
- User sets a rule for the agent → store it in a rules namespace
- Cron job needs to track state → persist last_run, counters, etc.
- Agent needs to recall a decision from a previous session → `memory_read` on demand, no manual pre-loading needed

## Limits

- **100 KB** per namespace — `memory_write` will reject writes that exceed this
- Do not store sensitive data: API keys, passwords, tokens

---

> ⚠️ **SAFETY**
>
> - **No credentials**: Never write API keys, tokens, or passwords into memory.
> - **No abuse**: Memory is for data that genuinely needs to persist, not temporary cache.
> - **Clear descriptions**: Always provide a meaningful description when creating a new namespace — it is injected into the system prompt so the agent (and user) can understand what the namespace contains at a glance.
