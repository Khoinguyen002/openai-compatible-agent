---
description: Automated workflow to analyze agent conversations and optimize prompts.
---

# Prompt Optimization

Automated workflow to analyze agent conversations and optimize prompts.

## Steps

1. **Export** — Run `npm run export` in `/Users/admin/Documents/OpenRouter_Agent` to generate a fresh merged JSONL file. The output file path will be printed to stdout.

2. **Analyze** — Run `npm run analyze -- <path-to-jsonl>` using the JSONL file path from step 1. This produces an analysis report at `exports/analysis_<timestamp>.md`.

3. **Read the analysis report** — Open and read the generated `exports/analysis_*.md` file (use the newest one). This report contains:
   - Confirmed hallucinations (agent claimed actions without tool calls)
   - Candidates for AI review (suspicious turns needing judgment)
   - Tool failures
   - Guide skips (skill tools used without reading guide first)
   - User corrections
   - Long sessions

4. **Review candidates** — For each item in "Candidates for AI Review", read the provided context and classify as: `HALLUCINATION`, `FALSE_POSITIVE`, or `AMBIGUOUS`.

5. **Root cause analysis** — Group all confirmed issues by root cause:
   - **Prompt gap** → missing rule or unclear instruction in `workspace/guides/soul.md` or skill guides
   - **Guide gap** → skill guide missing a pattern or constraint
   - **Model limitation** → issue inherent to the LLM, not fixable via prompt

6. **Propose changes** — For each prompt/guide gap, propose a **minimal, targeted diff** to the relevant file:
   - `workspace/guides/soul.md` — behavior rules, formatting, identity
   - `workspace/skills/cron/guide.md` — cron scheduling constraints
   - `workspace/skills/tools/guide.md` — tool registration constraints
   - `workspace/skills/memory/guide.md` — memory usage constraints

7. **Show diffs for review** — Present all proposed changes as diffs. Do NOT apply changes without explicit user approval.

8. **Apply approved changes** — After user approval, apply the diffs and summarize what was changed.

## Rules

- Never change prompts without showing diffs first
- Prefer minimal, surgical edits over large rewrites
- Do not add rules for one-off edge cases that happened once
- If an issue is a model limitation, document it but don't try to fix via prompt
- Keep all guides in English
