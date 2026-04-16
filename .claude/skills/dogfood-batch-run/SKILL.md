---
name: dogfood-batch-run
description: Run multiple diverse design prompts sequentially against the current agent build via the dev bridge, collect robust completion results, and summarize in a comparison table. Use when evaluating agent behavior across scenarios, regression-testing after changes, or exploring generation breadth.
triggers:
  - "跑几个 prompt"
  - "batch dogfood"
  - "跑一批设计"
  - "e2e 跑多个"
  - "多 prompt 测试"
  - "agent 广度测试"
  - "sse e2e"
---

# Dogfood Batch Run

Sequentially trigger N diverse design prompts against the running plugin, collect completion data robustly, and summarize. Used for breadth evaluation — not for iterating on a single prompt (that's `prompt-iteration-e2e`).

## When to use

- "Run 5-10 different designs and show me how the agent behaves"
- Post-change regression: "did my prompt edit break any scenario?"
- Generation quality dogfood across categories (dashboards, forms, landing, data-heavy, creative, etc.)

## When NOT to use

- Iterating on one prompt → `prompt-iteration-e2e`
- Auditing already-run triggers → `trigger-log-audit`
- One-off testing → just `curl` directly

## Prerequisites

1. Dev bridge server running on port 3456 (`curl -s localhost:3456/health`)
2. Figma plugin open in desktop app, on a **blank** or disposable file (each prompt will add a new root)
3. Build the plugin once: `node build.js`

## Step 1 — Pick diverse prompts

Avoid the tired trio: login page, admin dashboard, pricing card. They over-train user intuition and the LLM's training prior.

Target **breadth across dimensions**:

- **Layout**: single column, multi-column grid, kanban columns, week grid, dense feed, hero + detail
- **Content density**: sparse cards vs. data-heavy tables vs. text-heavy documents
- **Visual style**: neutral product UI, consumer glassmorphism, data viz, editorial, game-like
- **Interaction signal**: read-only vs. forms, toggles, dropdowns, overlays

Example 8-prompt dogfood set (2026-04-13, verified diverse):

1. Music player — visual density, multi-region layout, lyrics panel
2. Calendar week view — time-grid alignment, event stacking
3. AI chat interface — bubble flow, tool-call cards, meta-style
4. Fitness tracker — progress rings, mixed card sizes, streak indicator
5. Recipe detail — hero photo, ingredients checklist, numbered steps
6. Kanban board — repeating columns, consistent cards
7. Video call grid — 3x3 participant tiles, overlay badges, control bar
8. Notification center — grouped collapsible sections, per-item actions

Ask the user to pick or propose before running. Do **not** assume they want the canonical set.

## Step 2 — Build once

```bash
node build.js 2>&1 | tail -3
```

**Do not rebuild between prompts** if source code hasn't changed. Rebuilding forces Figma to auto-reload the plugin, and if a trigger arrives during the reload window (~500ms–2s), the plugin swallows it. See `prompt-iteration-e2e` § Swallowed-trigger recovery.

## Step 3 — Trigger + robust wait, one at a time

For each prompt:

```bash
PROMPT="<prompt text>"
TID=$(curl -s -X POST http://localhost:3456/trigger \
  -H 'Content-Type: application/json' \
  -d "{\"prompt\": \"$PROMPT\", \"reset\": true}" | jq -r '.id')
echo "triggered: $TID"
```

Use `reset: true` so each prompt gets a clean session (no conversation-history contamination from prior runs).

### Robust completion predicate

**Required** because `useDevBridge` may write a 300s placeholder before the real result (see `prompt-iteration-e2e` Step 3). Naive "SSE done → read meta" races this.

All must hold before declaring a run done:
- `meta.json` exists
- `status != "timeout"`
- `durationMs != 300000`
- `toolCallSummary.total > 0`
- `meta.json` mtime unchanged for **≥ 30s**

```bash
RD="/tmp/figma-bridge/results/$TID"
end=$(($(date +%s)+1200))  # 20 min hard ceiling per prompt
while [ $(date +%s) -lt $end ]; do
  if [ -f "$RD/meta.json" ]; then
    ok=$(python3 -c "
import json
d = json.load(open('$RD/meta.json'))
print('yes' if (d.get('status') != 'timeout'
                and d.get('durationMs', 0) != 300000
                and d.get('toolCallSummary', {}).get('total', 0) > 0) else 'no')
" 2>/dev/null)
    if [ "$ok" = "yes" ]; then
      age=$(( $(date +%s) - $(stat -f %m "$RD/meta.json") ))
      [ $age -ge 30 ] && break
    fi
  fi
  sleep 10
done
```

Run this in a **background Bash** (`run_in_background: true`). Each complex design typically takes 4–10 min. Don't block the main conversation.

### Swallowed trigger recovery

If after 60s there's no `$RD/` directory (plugin claimed but ran nothing), retrigger without rebuilding. Usually caused by plugin auto-reload if you rebuilt recently.

### Hang detection

If the plugin console shows tool calls stopped > 3 min ago AND no real result posted, the LLM probably hung (see `docs/knowledge/failure-pattern-silent-llm-hang-2026-04-13.md`). Document the hang, **move on to the next prompt** — don't block the batch.

## Step 4 — Collect and summarize

Once all runs finish (or fail), extract key metrics per trigger:

```bash
for TID in trigger-xxx-1 trigger-xxx-2 ...; do
  META="/tmp/figma-bridge/results/$TID/meta.json"
  [ -f "$META" ] && jq -r '[.triggerId, .status, .durationMs, .toolCallSummary.total, .toolCallSummary.errors, .toolCallSummary.capRejects, .modelName] | @tsv' "$META"
done
```

Present as a comparison table:

| # | Scenario | Duration | Tools | Errors | capRejects | Status |
|---|---|---|---|---|---|---|
| 1 | Music player | 309s | 29 | 4 | 1 | ✓ |
| 2 | Calendar week | 548s | 39 | 7 | 2 | ✓ |
| 3 | AI chat | hung | — | — | — | hang |
| ... | ... | ... | ... | ... | ... | ... |

`capRejects` = T4/T5/T6 cap rejections (retry signals, not tool failures). `errors` excludes these. Always report both columns.

### Delta comparison (when re-running after changes)

If this batch has a prior baseline, present a delta table:

| Metric | Baseline | Current | Δ |
|---|---|---|---|
| Duration | Xs | Ys | ±Ns (±%) |
| Tools | N | M | ±K |
| Errors (clean) | N | M | ±K |
| capRejects | — | M | new metric |
| delete→jsx cycles | N | M | ±K |

### Hook observability

Count `trigger_fired` events per run to verify hooks are active:

```bash
jq '[.runtimeEvents[] | select(.type == "trigger_fired") | .hookName] | group_by(.) | map("\(.[0])×\(length)") | join(", ")' "$META"
```

Hook data lives in `runtimeEvents`, **not** in `toolCallDetails`. See `trigger-log-audit` § Data source distinction for the full explanation.

Call out notable signals:
- **Error ratio** > 25% → investigate error-catalog for patterns
- **Tool count** dramatically higher than peer prompts (e.g. 48 vs 14) → agent over-refined or got stuck in an inspect loop
- **Duration** > 10 min → step-budget likely maxed, check whether design is complete
- **Hang failures** → document in `docs/knowledge/` with trigger ID, last tool call, model

## Common pitfalls

1. **Rebuilding between prompts** — causes plugin reload, may swallow next trigger. Build once.
2. **Triggering while previous is running** — plugin's trigger file is single-slot; second trigger queues. Always wait for completion before sending next.
3. **Exiting poll on first meta.json write** — placeholder at 300s looks like a result but isn't. Use the full predicate.
4. **Declaring a hung run "done" because console output stopped** — real completion writes `meta.json`. If no file, no completion.
5. **Assuming all prompts take similar time** — spread is huge. Music player 309s vs Notification center 515s vs AI chat (hung).
6. **Saving batch results to memory** — the table belongs in the conversation, not in persistent memory. Only insights (new failure patterns, cross-prompt behavior trends) are memory-worthy.

## Anti-patterns

- **Running 3 prompts in parallel to save time** — plugin is single-threaded; you'll just queue them with confusing interleaved state.
- **Picking prompts that all collide on one dimension** (e.g. three different dashboards) — you'll get noise-level differences, not breadth signal.
- **Not recording which model was used** — `meta.modelName` is the ground truth; a batch is only comparable if all runs used the same model.
- **Hiding failures** — a hung run is valuable data. Document it with the last tool call and the model; keep running the batch.

## Related

- `prompt-iteration-e2e` — single-prompt rule-compliance loop with diagnosis
- `trigger-log-audit` — post-hoc audit of existing trigger results
- `feedback_dev_bridge_patience.md` (memory) — lessons on placeholder timing and retrigger
- `docs/knowledge/failure-pattern-silent-llm-hang-2026-04-13.md` — known hang pattern
