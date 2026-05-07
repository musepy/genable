# Skill Audit & Optimization — 2026-05-07 Summary

Branch: `feat/dogfood-ui`
Method: SSE E2E baseline → atomic edit → 2-3 round verify → ROI delta → ship/defer

## What shipped

| Node | Change | Commit |
|---|---|---|
| **1.1 + 1.2** | Tighten create-page trigger (NOT for atomic) + selection rule #5 ("no skill matches → skip") | `e40e946` |
| **1.5** | Component-set: add_component_prop on SET only + JS sync API blocklist | `e1cda3d` |

## What was deferred (data-driven)

| Node | Original priority | Drop reason |
|---|---|---|
| 1.3 rich-text anti-pattern | medium | rich-text loaded 0 / 31 prompt-runs — no observed misuse |
| 1.4 全员 NOT for | medium | rule #5 covers most; restyle/rich-text/agent-page never observed loading |
| 1.6 restyle Classify front | low | restyle loaded 0 / 31 prompt-runs; no atomic-canvas test stresses it |
| 1.7 design-system rewrite | high (initial) | LLM uses current API (`ensure_collection`/`ensure_variable`) regardless of stale DSL examples in skill text — rewrite is token cleanup, not behavior fix. ROI/risk poor. |
| 1.8 agent-page archive | data decision | 0 / 99 historical loads, but not over-firing — harmless cost (~50 menu tokens). Keep. |

## Key metrics

### Skill load distribution

| | Baseline (9 prompts) | After 1.1+1.2+1.5 (9 prompts × 2 rounds) |
|---|---|---|
| create-page | 6 | 4 (avg 2/round) |
| component-set | 1 | 1 |
| design-system | 1 | 1 |

Drop in over-fire: **-67%** for create-page. Other skills unchanged.

### Per-prompt classification (baseline → post-fix)

| label | baseline | post-fix (avg 2 rounds) | verdict |
|---|---|---|---|
| PAGE_CLEAR | hit | hit | stable |
| COMPONENT_CLEAR | correct-skip | correct-skip | stable |
| WIDGET_BOUNDARY | **false-fire** | **correct-skip** | FIXED |
| DASHBOARD_CN | hit | hit | stable |
| COMPONENT_SET | hit (8 errors r1) | hit **(0 errors × 3 rounds)** | FIXED quality |
| DS_REQUEST | hit | hit (env-related errors persist) | stable, env work needed |
| NOTIF_CARD | **false-fire** | **correct-skip** | FIXED |
| PROFILE_CARD | **false-fire** | **correct-skip** | FIXED |
| TINY_CARD | **false-fire** | **correct-skip** | FIXED |

### Aggregate match rate

| | Baseline | Post-fix |
|---|---|---|
| skill_match_rate | 5 / 9 = 56% | 9 / 9 = 100% |
| false-fire on atomic-component prompts | 4 / 4 = 100% | **0 / 4** |

### Token / cost impact

- Per atomic-component prompt: ~3.5K tokens saved (skipped create-page load + style load)
- Per COMPONENT_SET run: ~36% fewer tools, ~32% shorter duration
- For a 100-prompt batch with mixed atomic/page mix (50/50): estimated ~150K tokens saved

## What the data taught us

1. **The "create-page over-fires" problem was real but localized.** Of the 6 skills, only create-page over-fired in the baseline. restyle / rich-text / agent-page never loaded at all in the test suite. design-system loaded only when DS-keyword prompt asked for it.

2. **Defense in depth works.** Edits to the menu rule (1.2) and the skill body (1.1) reinforce each other. Even when one path lets a wrong load through, the other catches it.

3. **Rule #5 ("no skill matches → skip") is the high-leverage edit.** Single line of text in the menu drove most of the false-fire reduction. Cheap, generic, applies to every skill.

4. **LLM uses current APIs even when skill text is stale.** design-system has 50+ lines of DSL examples (`var mk`, `comp combine`) but the LLM called `ensure_collection`/`ensure_variable` (the current tools). Stale text is dead weight (token cost) but not behavior-distorting at this level. Rewrite priority drops accordingly.

5. **Component-set's failure mode was a recovery cascade, not a single error.** The first error (`add_component_prop` returning "Component set has existing errors") was Figma being honest about set invalidity. The LLM's INTERPRETATION ("try each variant individually, then fall to js") was the real bug — the skill text didn't say "this means upstream is broken, fix that, don't escalate." Now it does.

6. **Test environment artifacts can mask real signal.** DS_REQUEST verify-r2 had 34 STALE_VARIABLE_FINGERPRINT errors — these are file-state pollution from prior runs leaving Figma variables in the file. Future test runs should reset Figma variables, not just conversation history.

7. **The ROI parser needed to recover late-arriving meta.json.** First-pass parser only trusted `DONE` from polling — but the bridge writes `meta.json` even after the polling script gives up. ~1/3 of "TIMEOUT" results were actually valid. Lesson: don't conflate "polling gave up" with "result didn't happen."

## Methodology — for future skill audits

```
1. Baseline batch (N prompts × 1 round)
   - Curate prompts to span trigger ambiguity (atomic vs page, EN vs CN, with/without aesthetic)
   - Include known-failure-mode prompts from history if available
   - Use reset: true per trigger
   - Robust completion predicate (status != timeout, durationMs != 300000, total > 0, mtime stable >= 30s)
   - 15-20 min ceiling per trigger; long hangs are environmental

2. ROI parser
   - Hard-code EXPECTED skill rubric per prompt label
   - Classification: hit / correct-skip / false-fire / wrong-skill / silent-skip
   - Recover from polling timeout by re-checking meta.json status

3. Per-edit verification
   - Same prompt set as baseline (control variables)
   - 2-3 rounds for variance check
   - Compare deltas, not absolute numbers
   - Distinguish behavior change from environment noise

4. Decision discipline
   - SHIP when fix is stable across rounds AND no regression on hits
   - DEFER when ROI is small or risk is high
   - DROP when data shows no observed misuse
   - Don't write code until data justifies it
```

## What remains (out of scope for this audit)

1. **find_skill tool** (Phase 3) — replace always-loaded menu with on-demand search. Estimated -30% prompt token cost. Big change, defer.
2. **frontend-design base skill** (Anthropic pattern) — extract shared design principles from create-page/restyle into a base skill. Currently each skill is an island.
3. **New skills evaluation** (polish/audit/harden from Impeccable) — current 6 skills cover create + restyle + variants + design-system. Post-creation lifecycle (polish, fix, harden) is empty.
4. **Test environment reset** — script to clear Figma variables/components between batches so DS_REQUEST runs don't accumulate state pollution.

## Files in this audit

- `.agent/skills/create-page/SKILL.md` (modified)
- `.agent/skills/component-set/SKILL.md` (modified)
- `src/engine/llm-client/context/knowledgeLibrarySection.ts` (modified)
- `docs/knowledge/skill-roi-node-1.1-1.2.md` (new)
- `docs/knowledge/skill-roi-node-1.5.md` (new)
- `docs/knowledge/skill-audit-2026-05-07-summary.md` (this file)
- `/tmp/skill-roi-parser.py` (parser, kept in /tmp — not committed; reusable for future audits)
- `/tmp/skill-baseline-batch-v2.sh` / `/tmp/skill-verify-batch.sh` (orchestration, /tmp)

## Total cost

- Wall time: ~6 hours (mostly E2E waits, parallelizable with other work)
- Total triggers: 31 prompt-runs (9 baseline × 1 + 9 verify × 2 + 4 verify-1.5)
- Lines of code changed: ~80
- Skills shipped: 2 fixes
- Skills deferred / dropped: 4 nodes — saved 8-12h of work that data showed wouldn't pay off
