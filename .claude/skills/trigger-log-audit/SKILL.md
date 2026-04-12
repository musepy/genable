---
name: trigger-log-audit
description: Audit recent dev bridge trigger results for tool usage patterns, output diversity, and semantic matching quality. Use when validating agent behavior after prompt/tool/runtime changes.
triggers:
  - "审计 trigger"
  - "trigger audit"
  - "对比 trigger"
  - "验证生成结果"
  - "compare trigger"
  - "check trigger logs"
---

# Trigger Log Audit

Systematic audit of dev bridge trigger results. Run after prompt/tool/runtime changes to confirm agent behavior is correct and outputs are diverse.

## Step 1: Discover Triggers

List recent trigger results:

```bash
ls -lt /tmp/figma-bridge/results/ | head -20
```

Ask the user how many triggers to audit (default: last 5). Collect the trigger IDs from the directory listing.

## Step 2: Extract Per-Trigger Summary

For each trigger ID, run the following jq extractions against its `meta.json`:

```bash
TRIGGER_ID="<id>"
META="/tmp/figma-bridge/results/$TRIGGER_ID/meta.json"

# Basic info
jq '{model: .modelName, status: .status, durationMs: .durationMs}' "$META"

# Tool distribution
jq '[.toolCallDetails[].name] | group_by(.) | map("\(.[0])×\(length)") | join(", ")' "$META"

# knowledge calls (action + query/id)
jq '[.toolCallDetails[] | select(.name == "knowledge") | .params]' "$META"

# ask_user calls
jq '[.toolCallDetails[] | select(.name == "ask_user") | .params]' "$META"

# errors
jq '[.toolCallDetails[] | select(.error != null and .error != "") | {name, error}]' "$META"

# user prompt
jq '[.conversationHistory[] | select(.role == "user") | .text] | first' "$META"
```

Also read `logs.txt` for the digest summary line:

```bash
head -5 /tmp/figma-bridge/results/$TRIGGER_ID/logs.txt
```

Present all triggers as a summary table:

| Trigger ID | Prompt (truncated) | Model | Status | Duration | Top Tools | Knowledge Calls | ask_user | Errors |
|---|---|---|---|---|---|---|---|---|

## Step 3: Homogeneity Check

If 2 or more triggers share the same (or very similar) user prompt:

1. Extract the first `jsx` tool call's params from each matching trigger:
   ```bash
   jq '[.toolCallDetails[] | select(.name == "jsx")] | first | .params' "$META"
   ```

2. Compare structure across runs:
   - Are the top-level frame names the same?
   - Are the same style IDs chosen (look for `style:*` in knowledge calls)?
   - Is the color palette (hex values in jsx params) byte-identical or nearly so?

3. Label the result:
   - **HOMOGENEOUS** — outputs are >90% similar (same style, same structure, same names)
   - **DIVERSE** — meaningful variation in style, layout, or component choices

Note: homogeneous outputs after a style-selection change indicate the agent is ignoring the new logic. Diverse outputs after a prompt tweak are expected and desirable.

## Step 4: Semantic Matching Check

For any trigger that called `knowledge` with action `"read"` on a `style:*` entry, judge whether the chosen style fits the prompt's product type.

Use this rough mapping (not exhaustive — use judgment for edge cases):

| Product type | Good style IDs | Poor style IDs |
|---|---|---|
| Settings / admin / dashboard | notion-zen, arctic-minimal, corporate-blue-light, slate-data | candy-pastel, neon-cyber |
| Gaming / esports / music | neon-cyber, midnight-gold, electric-cobalt, bold-editorial | warm-organic, cream-literary |
| Wellness / health / lifestyle | warm-organic, cream-literary, coral-commerce, forest-calm | fintech-dark, neon-cyber |
| Finance / banking | corporate-blue-light, fintech-dark, slate-data, swiss-grid | candy-pastel, electric-cobalt |
| E-commerce / retail | coral-commerce, midnight-gold, rose-gold-elegant, sunset-warm | fintech-dark, arctic-minimal |

For each trigger with a knowledge read, report:
- Prompt product type (inferred)
- Style ID chosen
- Judgment: APPROPRIATE / QUESTIONABLE / WRONG

## Step 5: Report

Present the full audit report:

```
## Trigger Audit Report

### Summary Table
| Trigger | Model | Duration | Tools | Knowledge | Errors |
|---|---|---|---|---|---|
...

### Homogeneity: DIVERSE / HOMOGENEOUS
[Describe which triggers share a prompt and what was compared. Call out exact style IDs or frame names if they match.]

### Semantic Matching: N/M correct
[One line per trigger with a style read: prompt → style → judgment]

### Recommendations
- [Any tool errors to investigate]
- [If HOMOGENEOUS: investigate style selection logic / ask_user flow]
- [If semantic mismatch: flag the specific prompt + style pair for review]
- [If no ask_user calls: check whether style selection is being triggered at all]
```

## Notes

- If a trigger has `status: "error"` or `status: "timeout"`, flag it immediately before the table.
- Empty `toolCallDetails` array = agent returned text only (no tools). Check `finalText` for error messages.
- The `durationMs` threshold for concern: >60 000ms (1 min) for a single-screen prompt is slow; >120 000ms is likely a stuck iteration.
- `runtime-events.json` contains the full event stream including `iteration_start`/`iteration_end` — useful for diagnosing where time was spent.
- `tree.json` contains the full serialized Figma node tree — can be diffed between runs for structural comparison.
