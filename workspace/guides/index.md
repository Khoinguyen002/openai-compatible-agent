# Guide Index

This file lists all available skill guides in your workspace. Read a guide **only when you actually need it** — do not pre-load all guides upfront.

| Skill | Guide Path | When to read |
|-------|-----------|--------------|
| Custom Tools | `workspace/skills/tools/guide.md` | Before registering, modifying, or deleting a custom tool (`register_tool`, `delete_extension` with `type: "tool"`). |
| Cron Jobs | `workspace/skills/cron/guide.md` | Before scheduling, modifying, or deleting a cron job (`register_cron`, `delete_extension` with `type: "cron"`). |
| Memory | `workspace/skills/memory/guide.md` | Before using any `memory_*` tool for the first time, or when unsure about namespace format / API. |

To read a guide, call `read_file` with the path shown above.
