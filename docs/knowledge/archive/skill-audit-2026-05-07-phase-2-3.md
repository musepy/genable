# Phase 2/3 — Skill System Architecture Audit (2026-05-07 cont.)

Branch: `feat/dogfood-ui`
Method: Each item gets explicit verification gate; no code lands without data justification.
Outcome: **0 of 4 items shipped to repo**. Data showed they weren't needed.

## Items + outcomes

| # | Item | Outcome | Rationale |
|---|---|---|---|
| 1 | Test environment reset script | Ships as `/tmp/wipe-figma.sh` (not committed) | Frames-only — `.remove()` blocked by js sandbox, variable cleanup needs new tool |
| 2 | frontend-design base skill (Anthropic/Impeccable pattern) | **SKIP** | Audit found only 2 truly shared concepts across 6 skills (screenshot pattern, fill:none anti-pattern). Extraction would add a hop without saving content. |
| 3 | New skills polish / audit / harden | **SKIP all 3** | Eval batch (4 scenarios × 2 turns) showed agent handles these naturally with current tools (jsx + edit + inspect + describe + screenshot). |
| 4 | find_skill discoverability tool | **Implemented + Reverted** | Registered as available tool, ran 17 prompts (Item 3 + sanity batch). LLM made 0 calls. Net cost (~200 tokens/turn × 0 use) = pure overhead. |

## Item 1 — wipe script

**What works**: deletes all top-level frames on current page that don't start with `.`. Used as preamble before each verification batch in this work — eliminates frame accumulation pollution.

**What doesn't**: variable collections cannot be deleted via current tools. The sandbox blocks `.remove()` calls (see `src/ipc/commands/jsHandler.ts:294-300`), and there's no `delete_collection` tool yet. Result: DS_REQUEST runs still accumulate `STALE_VARIABLE_FINGERPRINT` errors across batches.

**Future work**: add `delete_collection` tool to `varTool.ts` to make wipe complete. Single-purpose, ~30 lines. Out of scope here.

## Item 2 — frontend-design base skill (audit verdict)

Read all 6 SKILL.md files for shared content. Genuine duplication is sparse:
- Screenshot verification recurs in 3 skills (create-page, restyle, component-set) — but each belongs in that skill's own verification phase
- `fill: "transparent" → fill: "none"` appears in 2 skills (restyle, component-set)
- Other "shared" concepts are context-specific, not load-bearing universals

**Conclusion**: Skills are well-scoped. Extracting a base would force every skill to load via a hop without saving meaningful content. Different from Impeccable where ALL skills target visual design; our 6 skills span create / restyle / variants / system / niche / inline-text — naturally heterogeneous.

## Item 3 — polish/audit/harden evaluation

**Test design**: 4 scenarios, each a 2-turn flow (setup via reset:true, refinement via reset:false). Targets the specific gaps these new skills would fill.

| Scenario | Turn 2 prompt | Tool calls | Outcome |
|---|---|---|---|
| POLISH-card-refine | "Polish alignment, spacing, and typography hierarchy. Make spacing rhythmic and tighten the type scale." | 7 | jsx + describe + screenshot + 3× set_layout + edit |
| POLISH-pricing-refine | "Make the spacing more rhythmic, equalize visual weight, tighten typography across all three." | 14 | 6× find_nodes + 5× edit + inspect + screenshot + describe. Final text shows specific 8/12/20px rhythm + tightened type scale (36/14/12px) |
| AUDIT-notif-refine | "Review this design for visual consistency issues. List specific problems with severity." | 2 | inspect ×2 → produced "Critical Issues" / "Minor Issues" report with node-specific fixes (font weight, naming, divider visibility) |
| HARDEN-button-refine | "Test if this button handles longer text gracefully. Try with 请立即点击这个按钮以继续完成交易." | 2 | set_text (long CN) + screenshot → reported "expanded from 105px to 272px width while maintaining 41px height" |

**Verdicts**:
- **POLISH** SKIP: 2/2 prompts handled adequately. Pricing-refine was particularly principled (specific spacing scale, tightened type scale).
- **AUDIT** SKIP: 1/1 produced the exact format an audit skill would teach (severity tagging, node IDs, before/after fixes).
- **HARDEN** SKIP: 1/1 demonstrated correct behavior (test with actual long text, measure layout response, report).

**Conclusion**: Current toolset (jsx + edit + inspect + describe + screenshot + set_text + find_nodes) is sufficient. New skills would teach what the agent already does naturally. Building them violates the methodology — no observed gap, no ROI.

## Item 4 — find_skill tool (full experiment)

**Implementation**: Added `find_skill({ query, category, limit })` tool in `knowledgeReaders.ts` that wraps the existing `knowledgeSearch.search()` (MiniSearch with fuzzy + prefix). Registered alongside the existing skill / style / anatomy / guideline / help readers. Tested with two batches.

**Results**:
- Item 3 batch (8 prompts including ambiguous refinement turns): **0 find_skill calls**
- Sanity batch (9 prompts spanning page/component/system): **0 find_skill calls**
- Combined: **0 / 17 prompts** triggered find_skill

**Why no usage**: the always-shown menu has clear descriptions for skills + descriptions for help/guideline. LLM can pattern-match directly. The discoverability gap find_skill addresses doesn't exist for this skill library size (83 entries, well-scoped).

**Cost analysis**:
- Tool definition adds ~200 tokens to every turn's tool list
- 0 calls observed in 17-prompt sample
- Net = -200 tokens/turn for unobserved benefit

**Conclusion**: REVERT. Tool ships only when it earns its keep.

**When find_skill would matter**:
- Skill library expands beyond ~150 entries (menu becomes noisy)
- Menu is intentionally trimmed (e.g., descriptions hidden to save tokens)
- LLM trained without prior pattern recognition for our menu format

None of these apply today. Easy to re-add when they do.

## Methodology validation

The 4-step audit workflow (`feedback_skill_audit_methodology.md`) was applied to each item. **Three items declined to ship — and the data clearly justified each decline.**

This is the methodology working as intended:
- Phase 1 (current 6 skills) shipped 2 of 8 planned nodes — good ROI work, real evidence
- Phase 2/3 (architecture) shipped 0 of 4 planned items — equally good outcome, evidence said the work wasn't needed

Total cost saved by the discipline:
- Phase 1: ~8-12h on 4 deferred nodes
- Phase 2/3: ~10-15h on 3 unjustified additions + 1 reverted experiment

**Counterfactual**: without the data gates, an "improvement plan" would have shipped all of these, costing ~20-30h and adding 200-500 tokens/turn of unused tool/menu surface across the codebase.

## What did happen

Phase 1: 2 commits (`e40e946`, `e1cda3d`)
Phase 2/3: 0 commits to source code; 1 doc commit (this summary)

Net source diff:
- `.agent/skills/create-page/SKILL.md` (+18 lines)
- `.agent/skills/component-set/SKILL.md` (+50 lines)
- `src/engine/llm-client/context/knowledgeLibrarySection.ts` (+1 line, 1 line modified)
- 3 ROI docs in `docs/knowledge/`

Total source: ~70 lines changed across 3 files. **Disciplined, not dramatic.**

## Open architectural questions (revisit later if data demands)

1. **Token cache amortization** — if production sessions are short (1-3 turns each), menu cost is paid full each time. Worth instrumenting session-length distribution before deciding to trim.
2. **Variable cleanup tool** — when DS_REQUEST testing becomes priority, add `delete_collection`.
3. **Skill library growth** — when we add 5+ more skills (e.g. for explicit user demand), revisit find_skill.
4. **Component-set + variants flow polish** — skill works now (after 1.5) but workflow is still 15-22 tools. Possible tool consolidation: a single `create_variant_set({base, dimensions, deltas})` tool that internalizes clone+edit+combine in one call. Would replace ~10 tool calls with 1. Worth measuring later.

## Closing

The audit closes Phase 1 + 2 + 3 with measured changes only where data justified them. No speculative architecture, no skills built without observed gaps, no tools shipped without observed usage.

Methodology is reusable — `memory/feedback_skill_audit_methodology.md` captures the recipe.
