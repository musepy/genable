---
name: prompt-iteration-e2e
description: Closed-loop verification for SYSTEM.md prompt changes — build, SSE trigger, extract agent text, check rule compliance, diagnose violations. Use after every prompt edit; a rule that "looks right" often still fails under the LLM's training prior.
triggers:
  - "验证 prompt 改动"
  - "验证 SYSTEM.md"
  - "prompt e2e"
  - "prompt 迭代"
  - "agent 行为测试"
  - "iterate prompt"
  - "validate prompt change"
---

# Prompt Iteration E2E

Closed loop to prove a prompt change actually shifts agent behavior. Most "looks right" edits still fail — the LLM ignores a rule, over-applies it, or hits a training-prior conflict. Only E2E verification tells you which.

## When to use

- Edited `src/prompts/*.md` (SYSTEM.md, help entries, etc.)
- Adding / strengthening / relaxing TONE, OUTPUT, or any agent-facing rule
- Diagnosing why an existing rule is violated in production output

## Prerequisites

1. Dev bridge server running on port 3456 (`curl -s localhost:3456/health` returns ok)
2. Figma plugin open in desktop app (auto-connects to bridge)
3. Fresh git state ideal, so the next commit isolates this change

## Step 1 — Edit the prompt

Read the relevant section first. Use `Edit` with a specific `old_string`, never rewrite the whole file. Note the hypothesis before editing: *what behavior should shift, under which trigger*.

## Step 2 — Build

```bash
node build.js 2>&1 | tail -6
```

Must see "Build complete". `build.js` regenerates `src/generated/prompt-catalog.json`; without it the plugin reads the old prompt.

## Step 3 — Trigger and wait for real completion

```bash
TID=$(curl -s -X POST http://localhost:3456/trigger \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "<test prompt>", "reset": true}' | jq -r '.id')
echo "$TID"
```

### Completion detection (important — naive SSE is wrong)

The plugin's `useDevBridge` posts **up to two results** per trigger:
1. **300s placeholder** — at the 300s mark, `status: "timeout"`, `durationMs: 300000`, `toolCallSummary.total: 0`. Written even if the agent is still working fine.
2. **Real result** — when the agent's turn actually ends, overwrites the placeholder.

Server sends SSE `done` event on the **first POST** and then closes SSE connections. So waiting for SSE `done` only is **unsafe** — if the first POST is the placeholder, the real result arrives later but SSE is already closed.

**Correct predicate — all four must hold:**
- `meta.json` exists
- `status != "timeout"`
- `durationMs != 300000`
- `toolCallSummary.total > 0`
- `meta.json` mtime stable for **≥ 30s** (in case of a double-post where plugin overwrites)

```bash
RD="/tmp/figma-bridge/results/$TID"
end=$(($(date +%s)+1200))
while [ $(date +%s) -lt $end ]; do
  if [ -f "$RD/meta.json" ]; then
    done=$(python3 -c "
import json
d = json.load(open('$RD/meta.json'))
ok = (d.get('status') != 'timeout'
      and d.get('durationMs', 0) != 300000
      and d.get('toolCallSummary', {}).get('total', 0) > 0)
print('yes' if ok else 'no')
" 2>/dev/null)
    if [ "$done" = "yes" ]; then
      mt=$(stat -f %m "$RD/meta.json")
      age=$(($(date +%s) - mt))
      [ $age -ge 30 ] && break
    fi
  fi
  sleep 10
done

jq '{status, durationMs, toolCallSummary}' "$RD/meta.json"
```

Why not `?wait=N`: capped at 300s, returns `{status:"pending"}` on timeout — not a run verdict.

Why not SSE alone: see above. Use SSE to **observe live progress** during the run, but trust the filesystem predicate for completion.

### Swallowed-trigger recovery

Sometimes `curl POST /trigger` returns ok, `prompt.json` gets deleted, but **no result dir appears** and no tool calls fire. The plugin "swallowed" the trigger. Most common cause: you ran `node build.js` right before triggering, and the plugin was auto-reloading — the old instance claimed the trigger (DELETE + `generateFromPrompt`) but the page tore down before the agent started.

Signals a trigger was swallowed:
- No result dir at `/tmp/figma-bridge/results/$TID/` after 30–60s
- Plugin console shows no new activity
- Server's `/trigger` GET returns empty (plugin did claim it)

Recovery: **retrigger without rebuilding**. Code hasn't changed; the swallowed prompt is gone and the plugin is ready.

```bash
# Same prompt, same payload, no build
TID=$(curl -s -X POST http://localhost:3456/trigger \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "<test prompt>", "reset": true}' | jq -r '.id')
```

Prevention for deliberate build + trigger sequences: separate commands and add a short wait (`node build.js && sleep 3 && curl -X POST ...`). If the build didn't change anything the agent sees (e.g., only UI changes), skip the rebuild.

## Step 4 — Extract agent text

**Do NOT rely on `meta.finalText` alone** — it may be the last-turn only, missing earlier agent text within the same run.

Authoritative source is merged `text_delta` chunks from `runtime-events.json`:

```bash
META="/tmp/figma-bridge/results/$TID/meta.json"
EVENTS="/tmp/figma-bridge/results/$TID/runtime-events.json"

# Basic: model, duration, errors
jq '{model: .modelName, duration: .durationMs, summary: .toolCallSummary}' "$META"

# Agent's actual text (merged from stream)
jq -r '[.[] | select(.type == "text_delta") | .delta // .text // ""] | join("")' "$EVENTS"
```

## Step 5 — Check rule compliance

For each rule in the edited section, judge the agent text. Build a compact table:

| Rule | Verified against | Result |
|---|---|---|
| No emoji | regex `[\u{1F300}-\u{1F9FF}]` on full text | ✅ / ❌ |
| No preamble | first sentence | ✅ / ❌ |
| Don't list nodes | look for bullet lists that mirror frame/text hierarchy | ✅ / ❌ |
| Completion = design choices | final block talks WHY not WHAT | ✅ / ❌ |
| Errors = diagnosis + next step | any error-context text | ✅ / ❌ or N/A |

Quote the exact violating sentence in the report — vague claims like "agent violated TONE" are useless for diagnosis.

## Step 6 — Diagnose violations

For each ❌, classify root cause. Try fixes in this order (lowest cost first):

**Type A — Rule too abstract, LLM has no concrete anchor**
- Symptom: rule exists, agent reverts to its default pattern
- Example (2026-04-13): "Completion = design choices summary" → agent still listed tree nodes
- **Fix: add Bad / Good reverse examples directly under the rule.** Concrete contrast beats abstract instruction. Verified effective: violation on trigger-1776069847788 → clean summary on trigger-1776070833852 after adding examples.

**Type B — Rule buried, attention fades at point of use**
- Symptom: rule violated consistently at late moments (completion, error handling)
- Fix: move the rule closer to where it fires. E.g. completion rules near the end of SYSTEM.md.

**Type C — Rule conflicts with training prior**
- Symptom: strong LLM default (markdown formatting, friendliness, structured summaries) overrides a negative instruction
- Fix options, in order:
  1. Check if the rule is overreach — should it be relaxed? (2026-04-13: dropped "no markdown bullets in chat" — the default was fine, rule was overcorrection)
  2. Replace negative ("don't Y") with positive ("do X") — gives the model a direction, not just a taboo
  3. Only if 1-2 fail: add an explicit conflict note ("your training prefers X, but in this context do Y because...")

**Do not default to Type B.** Moving position has collateral impact on other rules' relative weight. Try Type A first.

## Step 7 — Re-loop

Go to Step 1 with the diagnosis-driven fix. Stop when:
- All rules verify ✅ on one matching prompt, AND
- At least one prompt outside the rule's domain runs without regression (catches over-application)

## Common pitfalls

1. **Skipping build** — `build.js` regenerates `prompt-catalog.json`. No build = still testing old prompt. Symptom: identical output after "edit".
2. **Reading `meta.finalText` only** — that's session-compressed, not agent's raw output. Always merge `text_delta` from runtime-events.
3. **Single-run conclusion** — one run is noise. LLMs are stochastic. Re-run the same prompt at least once to separate signal from jitter. Ideally also run one prompt outside the rule's domain.
4. **Trusting `?wait=N` or SSE `done` alone for completion** — `?wait` is capped at 300s; SSE `done` fires on the first POST, which may be the 300s placeholder (see Step 3). Filesystem + full predicate is ground truth.
5. **Build-reload race swallows triggers** — `node build.js` then immediately `curl POST /trigger` can race the plugin's auto-reload, leaving the prompt claimed but never run. See "Swallowed-trigger recovery" in Step 3.
6. **Canvas state contamination** — previous runs leave nodes on Figma canvas. Either use `reset: true` in the trigger (resets agent history but not canvas), start on a blank Figma file, or pick a prompt that doesn't collide with existing content. The 2026-04-13 login-card test hit a pre-existing login page and the agent forked into a "modify existing?" branch, muddying the rule-compliance read.
7. **Node ID confusion across runs** — if you're comparing two runs, first check whether they share node ID prefixes (`140:xxxx` vs `1538:xxxx`). Different prefix = different runs. Do not merge their observations into one narrative.

## Anti-patterns

- **"The rule says X, so agent will do X"** — no. Rules are suggestions weighted against training priors. Always verify.
- **Adding a rule without E2E proof it lands** — inflates prompt tokens for unknown benefit. Every rule deserves one verified commit.
- **Deleting a rule that "seems wrong"** before testing what it prevents — it may have hidden value. Relaxing 2026-04-13's TONE markdown ban was correct only because violation cost was shown to be low; other rules may not be that cheap.
- **Synthesizing a root cause without data** — if a rule is violated, do not immediately declare "rule conflict in SYSTEM.md line X/Y/Z" before reading the actual agent text. The 2026-04-13 session's upstream Claude invented a 3-rule conflict theory from a screenshot instead of the trigger data; the theory was wrong and the trigger data was a different run entirely.

## Related

- `trigger-log-audit` — use after multi-prompt prompt work to compare across runs
- `.agent/error-catalog.md` — if agent hits tool errors during your E2E, check here first
- `src/prompts/SYSTEM.md` structure: TONE and OUTPUT sections near top (identity layer); SCENE GRAPH and downstream sections are mental-model layer
