---
name: two-layer-tool-test
description: Verify refactors that change tool handlers via two layers — mcp__genable__* direct calls (no LLM) for implementation correctness, then dev bridge curl (LLM agent) for prompt-following. Mixed runs hide which layer failed.
triggers:
  - "tool refactor 验证"
  - "two-layer test"
  - "工具层 + LLM 层测试"
  - "mcp + dev bridge 测试"
  - "tool handler regression"
  - "verify tool refactor"
  - "registry 改动验证"
---

# Two-Layer Tool Test

Refactor verification protocol for changes that touch tool handlers, registry-derived behavior, runtime hooks, or anything that affects both **what tools return** and **how the LLM uses them**. Tests run in two strictly separated layers so pass/fail attributes to the right cause.

## When to use

- Changed a tool handler in `src/ipc/commands/`
- Changed registry / helpers / facets / bindable rules
- Changed runtime hooks (gate, dirty, tracker)
- Changed setter / write-side derivation
- Renamed / restructured tool descriptions LLM sees
- Added a new first-class tool

## When NOT to use

- Pure prompt edit (use `prompt-iteration-e2e`)
- Pure UI / chat-component change (use `ui-ab-preview` or `design-review`)
- Property/visual verification of generated nodes (use `httpbridge-api-test`)
- Quick sanity check on one design output (use `dogfood-batch-run`)

## Layers

| Layer | Channel | Verifies | Owns |
|---|---|---|---|
| **A — Tool layer** | `mcp__genable__*` direct (WS relay :3458) | Implementation correctness: response shape, error message text, registry consultation, edge cases | Whether the wire works |
| **B — LLM layer** | `POST :3456/trigger` + long-poll `/result/:id?wait=600` | LLM picks the right tool, reads errors, recovers, doesn't fall back to `js` | Whether the description teaches |

**Rule**: do NOT mix the layers in one test runner agent. Pass criteria differ; failure attribution gets lost.

## Prerequisites

```bash
# Both bridges must be up
curl -s http://localhost:3456/health      # dev bridge for Layer B
lsof -nP -i:3458 | head -2                 # MCP relay process for Layer A

# Plugin must be reloaded after every build (auto-reconnects in 5s)
node build.js                               # rebuild before testing
```

If `mcp__genable__*` returns "Figma plugin is not connected" — user must reload plugin in Figma desktop. Don't retry blindly.

## Layer A — tool-level

Dispatch a sub-agent (general-purpose, foreground) with:

1. **Setup fixtures** with prefix `phaseA-` (don't clean up — Layer B reuses them):
   - `mcp__genable__create_collection` → save IDs
   - `mcp__genable__create_variable` × N → cover FLOAT, COLOR, BOOLEAN, STRING types as needed
   - `mcp__genable__jsx` → create test frames
2. **Mechanical pass criteria per test case** — list expected response shape / error substring in the brief, agent compares verbatim
3. **Test the changed surface only** — for a `bind_variable` refactor, exercise: valid bind, type mismatch, computed-prop reject, non-bindable enum reject, plus any newly-bindable fields
4. **Per-test report**: `T<N> [PASS/FAIL]: <one-line>` + raw response sample (≤ 150 chars) + failure analysis if FAIL

Layer A passing = the implementation works. Failure here = real regression, not a prompt issue.

## Layer B — LLM-level

Dispatch a sub-agent (general-purpose, foreground) AFTER Layer A passes. Brief with:

1. **Reuse Layer A fixtures** (frame IDs, variable IDs from Layer A's report)
2. **5–7 natural-language prompts** that SHOULD drive specific tool sequences. Each prompt has:
   - Pass signals: which tools must be called, with which params (or substring patterns)
   - Fail signals: `js` fallback, tool not used, wrong recovery, infinite retry
3. **Build before triggering** (per `feedback_build_before_test`)
4. **Sequential triggers** — plugin processes one at a time, parallel curls just queue
5. **Long-poll `?wait=600`** per trigger; check `/tmp/figma-bridge/results/<id>/events.jsonl` if response is empty/timeout

Layer B failing while Layer A passed = LLM description / prompt teaching issue, NOT an implementation bug. Fix the tool description, not the handler.

## Test design heuristics

- For each new validation rule (e.g. width/height rejection): one Layer A test (the error fires correctly) + one Layer B test (LLM reads error and recovers)
- For each new tool (e.g. find_references): one Layer A positive + one negative (zero results) + one Layer B test where LLM reaches for it without prompting hint
- For each removed legacy alias (e.g. `mode:"detail"`): Layer A confirms hard reject; Layer B confirms LLM doesn't try it
- For facet-style API: Layer A exercises every facet enum value; Layer B confirms LLM uses the right facet for the question

## Anti-patterns

- ❌ Running both layers in one agent — failure attribution lost
- ❌ Dispatching parallel triggers to dev bridge — they queue, the second times out
- ❌ Cleaning up fixtures between layers — Layer B can't reuse, has to recreate
- ❌ Using `js` tool to "verify" Layer A results — that's what we're trying to make obsolete
- ❌ Skipping Layer B when only the description text changed — that's exactly when description changes need verification
- ❌ Treating "Layer A pass + Layer B fail" as a regression — it's a teaching/prompt issue

## Reference

- `feedback_two_layer_testing.md` (memory) — methodology origin
- `httpbridge-api-test` — adjacent skill, focuses on visual property verify (not LLM behavior)
- `prompt-iteration-e2e` — adjacent skill, only covers Layer B for prompt-only changes
