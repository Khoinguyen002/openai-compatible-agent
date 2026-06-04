# Guide Index

This file lists all available guides in your workspace. Read a guide **only when you actually need it** — do not pre-load all guides upfront.

| Guide | Path | When to read |
|-------|------|--------------|
| Custom Tools | `workspace/guides/tools.md` | Before registering, modifying, or deleting a custom tool (`register_tool`, `delete_extension` with `type: "tool"`). Contains the JS template, path conventions, and safety rules. |
| Cron Jobs | `workspace/guides/cron.md` | Before scheduling, modifying, or deleting a cron job (`register_cron`, `delete_extension` with `type: "cron"`). Contains the execution model, payload format, and safety rules. |

To read a guide, call `read_file` with the path shown above.
