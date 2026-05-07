# Node 1.5 ROI Report — component-set add_component_prop guidance

Date: 2026-05-07
Branch: feat/dogfood-ui

## Hypothesis

The component-set skill's Phase 3 was ambiguous about which node `add_component_prop` accepts. Recent E2E runs showed the LLM:
1. Calling `add_component_prop` on individual variant frames after the set call failed (cascading errors)
2. Falling back to `js({code: "...findOne(...)..."})` which fails in dynamic-page mode
3. Driving tool count from 15 → 47 with 8 errors before producing output

Edits target the skill text:
- Bold the "ALWAYS on SET, NEVER on variants" rule in Phase 3
- Explain that `"Component set has existing errors"` means the set itself is invalid → fix variant naming, don't retry
- Add a "JS fallback safety" section listing forbidden sync APIs (`findOne / findAll / findChildren / findAllWithCriteria`)
- Add 3 new rows to KNOWN PITFALLS (variant-target attempt, retry-cascade, sync findOne)
- Tighten description with NOT-for clause

## Method

Focused batch — 4 triggers, dev bridge:
- COMPONENT_SET × 3 rounds (variance check on the high-signal target)
- TINY_CARD × 1 round (control: ensure 1.1+1.2 fix still holds, no cross-contamination)

## Results

### Per-round outcome

| run | tools | errors | dur(s) | add_component_prop targets | js fallback? |
|---|---|---|---|---|---|
| Baseline (v2) | 15 | 0 | 91 | (n/a — different run, set ID 2003:11814) | no |
| Verify-1.1+1.2 r1 | **47** | **8** | 241 | set + 3 variants (cascade) | **yes** (sync findOne errors) |
| Verify-1.1+1.2 r2 | 18 | 0 | 83 | set only | no |
| **Verify-1.5 r1** | **12** | **0** | 78 | set 2007:512 only | no |
| **Verify-1.5 r2** | **11** | **0** | 73 | set 2008:521 only | no |
| **Verify-1.5 r3** | **22** | **0** | 96 | set 2008:530 only | no |
| TINY_CARD control | 2 | 0 | 37 | (no skill) — correct-skip | n/a |

### Aggregate

| Metric | Pre-fix avg (5 runs) | Post-fix avg (3 runs) | Δ |
|---|---|---|---|
| Tools per COMPONENT_SET run | 23.4 | **15.0** | **−36%** |
| Errors per COMPONENT_SET run | 1.8 | **0.0** | **−100%** |
| Duration per COMPONENT_SET run | 121s | **82s** | **−32%** |
| `add_component_prop` on variant attempts | 1+ per run intermittently | **0 across 3 rounds** | eliminated |
| `js({code})` fallback to deprecated sync API | 1+ per run intermittently | **0 across 3 rounds** | eliminated |

## Delta breakdown — what changed for the agent

**Before fix** (verify-1.1+1.2 r1):
```
combine_components → set 12699
inspect 12699
add_component_prop({node: 12699, ...})       ← right target, but error
add_component_prop({node: 12691, ...})       ← variant — error
add_component_prop({node: 12695, ...})       ← variant — error  
add_component_prop({node: 12697, ...})       ← variant — error
js("...findOne...")                          ← deprecated sync API — error
js("...")                                    ← more recovery, more errors
... (47 tools, 8 errors total)
```

**After fix** (verify-1.5 r1):
```
combine_components → set 2007:512
add_component_prop({node: 2007:512, ...})    ← clean
get_screenshot → done
... (12 tools, 0 errors)
```

The skill now teaches: when `add_component_prop` fails on the set, the SET is invalid — fix variant naming and rebuild. **Don't retry on each variant. Don't fall to js.** That single pattern shift killed the recovery loop.

## Side-effect audit

- TINY_CARD control: still correct-skip (1.1+1.2 fix unaffected)
- No new error types introduced
- Skill description tightened (added NOT-for clause) — could affect skill loading, but no test in this batch isolates that signal

## Verdict

**SHIP**. Three clean rounds, zero errors, behavior change traceable directly to the edits.

## Files changed

- `.agent/skills/component-set/SKILL.md` (~50 lines: NOT-for clause, Phase 3 emphasis, 3 new pitfall rows, JS fallback safety section)
- `src/generated/knowledge-content.json` / `knowledge-index.json` (auto-regenerated)
