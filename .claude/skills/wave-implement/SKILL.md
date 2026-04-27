---
name: wave-implement
description: Multi-wave incremental implementation — group changes by complexity, implement each wave with build+typecheck+test gates, commit atomically
trigger: (开始执行|开始实现|implement|execute|wave|分波|逐步实现|按计划执行)
---

# Wave Implementation

Incremental implementation strategy: group changes from easy to hard, verify after each wave.

## Pre-flight: Plan agent first if scope is large

If the refactor touches 5+ files OR cuts across read+write+test layers OR has architectural ambiguity, **dispatch the Plan agent BEFORE executing**:

```
Agent({ subagent_type: "Plan", description: "...", prompt: "...phased plan request..." })
```

Ask Plan for: phase breakdown with dep order, per-phase file lists, risk/compat notes, test strategy per phase, agent dispatch sketch. Don't write code in the planning phase. Review the plan with the user before kicking off Wave 1.

## Pre-flight: Phase 0 audit when retiring hand-coded sources

When the refactor's goal is "make X the single source of truth" (replacing hand-coded lists, allowlists, switch tables, parallel registries), insert a **Phase 0 read-only audit** before Phase 1:

- Grep every hand-coded source the refactor will retire
- For each source, list contents and compare to the SSOT target
- Output a "deltas" table: what's in source-of-truth but not in target, and vice versa
- No code changes; pure inspection

Phase 0 catches hidden coverage gaps (e.g. registry missing fields the old allowlists silently included) BEFORE Phase 1 commits the wrong baseline. Saves rework.

## Process

### Step 1: Plan Waves
Group all planned changes into waves by complexity and risk:

| Wave | Criteria | Example |
|------|----------|---------|
| **Wave 1** | Pure additions, no architecture change, < 10 lines each | New shorthands, new entries in registries |
| **Wave 2** | New standalone modules, no existing file coupling | New parser, new utility file |
| **Wave 3** | Modifications to existing handlers/pipelines | Extending a handler, adding a branch |
| **Wave 4** | New architecture layers, execution flow changes | New pre/post processing step in pipeline |

### Step 2: Execute Each Wave
For each wave:

1. **Create task** (TaskCreate) with wave description
2. **Read all files** that will be modified — understand before changing
3. **Make changes** — all changes in the wave as a batch
4. **Type check**: `npx tsc --noEmit` — must pass before proceeding
5. **Run tests**: `npx vitest run [relevant-dirs]` — verify no regressions
6. **If tests fail**: check if failures are pre-existing (git stash, rerun, unstash)
7. **Mark task completed** with summary of changes
8. **Move to next wave**

### Step 3: Full Verification
After all waves:
1. Full test suite: `npx vitest run`
2. Build: `node build.js`
3. If dev bridge available: E2E test with `curl POST /trigger`

### Step 3.5: LLM-facing wave needs dev bridge soak

If a wave changed any of these, **do not chain straight into the next wave**:
- Tool definition `description` field (LLM sees it)
- Tool parameter schema enum / required fields
- Bind/setter/edit error message text (LLM reads it for recovery)
- New first-class tool registered in `agent/tools/unified/`
- System prompt or any `src/prompts/*.md`

These are prompt-adjacent. Run dev bridge validation BEFORE starting the next wave that depends on the changed surface:

- For tool handler refactors: invoke `/two-layer-tool-test` (Layer A first, then Layer B prompts that exercise the new surface)
- For pure prompt edits: invoke `/prompt-iteration-e2e`
- For property/visual changes: invoke `/httpbridge-api-test`

If the next wave doesn't depend on the LLM picking up the change correctly, the validation can be deferred to Step 4 — but flag it explicitly in the wave report so the user knows what's still unverified.

### Step 4: Commit
Single atomic commit covering all waves, or per-wave commits if user prefers.

For multi-phase / multi-wave landings: prefer per-phase commits grouped logically (registry change | API change | cleanup). The user can later squash, but losing phase boundaries is hard to recover.

## Key Behaviors
- **Never skip type check** between waves — catch errors early
- **Pre-existing test failures**: verify by stashing changes, don't waste time fixing unrelated tests
- **Build after all waves** — not after each wave (build is slow, type check is fast)
- **E2E is optional only when no LLM-facing surface changed** — see Step 3.5
- **Report concisely**: "Wave N complete. X files, Y tests pass. Moving to wave N+1."
- **If a wave fails**: stop, diagnose, fix. Don't proceed to next wave with broken state.
- **If Phase 0 audit was skipped and Wave 1 surfaces a coverage gap**: pause, run the audit late, recompute scope. Faster than committing the wrong baseline and rebasing later.

## Related skills

- `/two-layer-tool-test` — verification for tool-handler refactors (paired Layer A + Layer B)
- `/prompt-iteration-e2e` — verification for pure prompt edits
- `/httpbridge-api-test` — visual / property verification of generated nodes
- `/parallel-file-split` — split a wave's edits across sub-agents when files are independent
- Plan agent (`subagent_type: "Plan"`) — phased plan output before this skill executes
