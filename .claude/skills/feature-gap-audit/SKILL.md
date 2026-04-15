---
name: feature-gap-audit
description: Systematic feature coverage analysis — compare current capabilities against a target spec, tier gaps by impact, discuss each with user, track decisions
trigger: (gap|coverage|差距|覆盖率|对比|audit|缺什么|还差什么|能力盘点)
---

# Feature Gap Audit

Systematic analysis of what the system supports vs what's needed for a target scenario.

## Process

### Phase 1: Inventory (automated)
1. **Scan current capabilities** — read relevant source files to build a complete inventory of what exists (types, properties, handlers, mappings, etc.)
2. **Present as structured table** — category | name | behavior | coverage status

### Phase 2: Gap Analysis (automated)
1. **Compare against target** — the target scenario the user describes (e.g., "web page reproduction", "design system", "mobile app")
2. **Tier the gaps by impact**:
   - Tier 1: Almost every target will need this (must have)
   - Tier 2: Most targets will encounter this (should have)
   - Tier 3: Specific scenarios only (nice to have)
3. **For each gap, note**: what's missing | what Figma/system already supports | estimated complexity

### Phase 3: Discussion (interactive, with user)
1. **Create task list** for all gaps (use TaskCreate)
2. **Go through each gap one by one** — set task to in_progress
3. For each gap, present:
   - What the target concept does
   - How to translate it to current system primitives
   - Proposed implementation approach
   - Open questions for user
4. **Capture user corrections** — they often know Figma capabilities better than the inventory suggests
5. **Record decision** — update task with conclusion, mark completed
6. After all gaps discussed, **write summary doc** to `docs/knowledge/`

### Phase 4: Implementation Planning
1. **Group decisions into implementation waves** by complexity:
   - Wave 1: Simple additions (few lines, no architecture change)
   - Wave 2: New parsers/modules (standalone files)
   - Wave 3: Handler/pipeline changes (existing file modifications)
   - Wave 4: Architecture changes (new layers, execution flow changes)
2. **Estimate each wave**: files changed, lines added, risk level

## Key Behaviors
- **Don't assume** — when unsure about a platform capability (Figma API, CSS spec), ask or check
- **User corrections are gold** — they reveal real platform behaviors not in docs. Always update the analysis.
- **Track progress** — use TaskCreate/TaskUpdate throughout Phase 3
- **Write to docs/knowledge/** — the audit result is a project asset, not just conversation ephemera
- **语言**: Follow user's language preference (Chinese explanations if user writes Chinese)
