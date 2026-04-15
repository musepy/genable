---
name: wave-implement
description: Multi-wave incremental implementation — group changes by complexity, implement each wave with build+typecheck+test gates, commit atomically
trigger: (开始执行|开始实现|implement|execute|wave|分波|逐步实现|按计划执行)
---

# Wave Implementation

Incremental implementation strategy: group changes from easy to hard, verify after each wave.

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

### Step 4: Commit
Single atomic commit covering all waves, or per-wave commits if user prefers.

## Key Behaviors
- **Never skip type check** between waves — catch errors early
- **Pre-existing test failures**: verify by stashing changes, don't waste time fixing unrelated tests
- **Build after all waves** — not after each wave (build is slow, type check is fast)
- **E2E is optional** — only if user has Figma desktop running with plugin loaded
- **Report concisely**: "Wave N complete. X files, Y tests pass. Moving to wave N+1."
- **If a wave fails**: stop, diagnose, fix. Don't proceed to next wave with broken state.
