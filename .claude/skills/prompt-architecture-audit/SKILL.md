---
name: prompt-architecture-audit
description: Audit system prompt for WHAT/WHY vs HOW content balance. Classifies each section, quantifies token waste, and produces a migration plan to externalize HOW into knowledge entries. Use when system prompt grows beyond ~5K tokens or when adding new prompt sections.
triggers:
  - "审计 prompt"
  - "prompt audit"
  - "prompt 瘦身"
  - "system prompt 太长"
  - "prompt architecture"
  - "audit system prompt"
---

# Prompt Architecture Audit

System prompts accumulate HOW content over time. This skill classifies every section as WHAT/WHY (keep) vs HOW (externalize), quantifies the imbalance, and produces a concrete migration plan.

**Target**: HOW content < 20% of total system prompt tokens.

---

## Step 1: Measure Current State

Read the primary prompt source and understand how the full prompt is assembled:

```bash
wc -c src/prompts/SYSTEM.md
```

Then read:
- `src/prompts/SYSTEM.md` — core static prompt
- `src/engine/llm-client/context/system.ts` — full assembly: `buildStaticSystemPrompt()`, injected sections, dynamic context
- `src/engine/llm-client/context/knowledgeLibrarySection.ts` — the knowledge menu injected at runtime

List all `##` sections in SYSTEM.md:

```bash
grep -n "^## " src/prompts/SYSTEM.md
```

Also note which sections are injected from outside SYSTEM.md (dynamic context, autonomous behavior const, knowledge library).

---

## Step 2: Classify Each Section

For each `##` section, assign exactly one label:

| Label | Meaning | Examples |
|-------|---------|---------|
| **WHAT** | Identity, environment, fundamental constraints | "You are a Figma plugin agent", "Figma scene graph is a tree", "Use frame for ALL UI containers" |
| **WHY** | Mental model corrections, design frameworks, principles | "FIGMA ≠ CSS: auto-layout is NOT flexbox", "DESIGN THINKING 7 dimensions", "padding 29%→30% root cause" |
| **HOW** | Procedures, step-by-step workflows, checklists, templates, examples with specific values | "Step 1: jsx, Step 2: describe, Step 3: edit", "Call knowledge first when...", "Frame corner:8 bg:..." |

### Classification Heuristics

Apply these tests in order — first match wins:

1. **Contains specific values / code examples** → HOW. Examples: `corner:8`, `gap:16`, `Frame corner:8 bg:...`.
2. **Numbered steps or ordered procedure** → HOW. Signals: "Step N:", "First X then Y", "4-step gate".
3. **"must / always / never" rules that are actionable** → HOW if they prescribe a sequence; WHY if they correct a mental model.
4. **Corrects a Figma-vs-CSS misconception** → WHY. Signal: "Figma does NOT...", "Unlike CSS...", "FIGMA ≠ CSS".
5. **Declarative identity or environment fact** → WHAT. Signal: "You are...", "The scene graph...", "This plugin runs in...".
6. **Design framework or thinking dimension** → WHY if it's a mental model (DESIGN THINKING 7 dims); HOW if it's a checklist ("for each frame: check layout, check gap...").

### Borderline Cases

- A table of design dimensions → **WHY** (thinking framework, not a procedure)
- A table that's a completion checklist → **HOW** (prescribes actions)
- "Use frame for ALL UI components" → **WHAT** (fundamental constraint, not a procedure)
- "Call knowledge() when uncertain about component anatomy" → **HOW** (procedure trigger)

### Output: Classification Table

| Line range | Section | Classification | Reasoning (1 line) |
|------------|---------|----------------|---------------------|
| L1–L40 | `## IDENTITY` | WHAT | Declares agent role and environment |
| L41–L90 | `## DESIGN THINKING` | WHY | Framework for thinking, not a procedure |
| L91–L140 | `## CREATION WORKFLOW` | HOW | Step-by-step instructions with ordered gates |
| ... | ... | ... | ... |

---

## Step 3: Quantify Token Budget

Estimate tokens using chars ÷ 4 (GPT-style approximation):

```
SYSTEM.md total chars → ÷ 4 = ~N tokens

WHAT sections: N chars → ~N tokens (N%)
WHY sections:  N chars → ~N tokens (N%)
HOW sections:  N chars → ~N tokens (N%)
```

Also measure injected sections separately (Step 5).

**Budget health**:
- HOW < 10% → Healthy
- HOW 10–20% → Acceptable, monitor
- HOW 20–35% → Needs pruning soon
- HOW > 35% → Critical — migration required

---

## Step 4: Migration Plan

For each HOW section, determine where it should live instead.

First, check for existing knowledge entries:

```bash
# Search knowledge index for related IDs
cat src/generated/knowledge-index.json | grep -i "<section-keyword>"
```

Then for each HOW section:
- **Exists**: which `knowledge-index.json` entry id? Can HOW content be merged/appended there?
- **New needed**: propose entry id following convention `help:<topic>` (e.g., `help:layout-quality`, `help:creation-gate`, `help:component-anatomy`). New entries live in `src/prompts/help/`.

### Output: Migration Table

| Section | Lines | ~Tokens | Target knowledge entry | Status | Action |
|---------|-------|---------|------------------------|--------|--------|
| `## CREATION WORKFLOW` | L91–L140 | ~320 | `help:creation-workflow` | exists | Merge step-by-step into existing entry, replace section with 1-line pointer |
| `## VARIABLE BINDING` | L200–L240 | ~180 | `help:variable-binding` | new | Create `src/prompts/help/variable-binding.md`, remove section |
| ... | ... | ... | ... | ... | ... |

**Replacement pattern**: after migrating a HOW section, replace it with a single WHY sentence that anchors the mental model, removing the procedural detail. Example:

> Before: `## CREATION WORKFLOW` (40 lines of steps)
> After: `## CREATION WORKFLOW` (1 line: "Build progressively — skeleton → regions → details → verify. See knowledge: help:creation-workflow.")

---

## Step 5: Injected Sections Audit

The system prompt includes content injected outside SYSTEM.md. Audit each:

### KNOWLEDGE LIBRARY section (`knowledgeLibrarySection.ts`)
```bash
wc -c src/engine/llm-client/context/knowledgeLibrarySection.ts
```
- How many entries listed? How many tokens does the menu consume?
- Is the menu growing with every new knowledge entry? Is there a cap?
- Red flag: > 500 tokens for the menu itself

### AUTONOMOUS BEHAVIOR const (`system.ts`)
- Find the inline const in `buildStaticSystemPrompt()`
- Classify it: is it WHAT/WHY (keep inline) or HOW (should be a knowledge entry)?

### Dynamic context (`dynamicContext.ts` or equivalent)
- Format: `[Iteration N/M]` — confirm this is minimal (< 50 tokens per iteration)
- Does it inject anything else that could bloat per-call token cost?

### Output: Injected Sections Table

| Source | Content | ~Tokens | Type | Action |
|--------|---------|---------|------|--------|
| `knowledgeLibrarySection.ts` | Knowledge menu (N entries) | ~N | WHAT | Monitor size; cap at 30 entries |
| Inline `AUTONOMOUS_BEHAVIOR` | Behavior guidance | ~N | WHY/HOW | Audit sub-sections |
| Dynamic context | `[Iter N/M]` | ~30 | WHAT | OK, already minimal |

---

## Step 6: Final Report

Produce a structured report in this format:

```
## Prompt Architecture Audit — [date]

### Current State
- SYSTEM.md: N chars / ~N tokens
- Injected sections: N chars / ~N tokens
- Total static prompt: ~N tokens
- Per-iteration dynamic context: ~N tokens

### Section Classification
| Section | Type | ~Tokens | % of total |
|---------|------|---------|------------|
| IDENTITY | WHAT | N | N% |
| DESIGN THINKING | WHY | N | N% |
| CREATION WORKFLOW | HOW | N | N% |
| ... | | | |

### Balance
- WHAT: N tokens (N%)
- WHY: N tokens (N%)
- HOW: N tokens (N%) ← target <20%
- Status: [Healthy / Needs pruning / Critical]

### Migration Plan
| HOW Section | → Knowledge entry | Tokens saved | Priority |
|-------------|-------------------|-------------|----------|
| CREATION WORKFLOW | help:creation-workflow | ~320 | High |
| ... | | | |

Total recoverable: ~N tokens (N% of prompt)

### Recommendations (prioritized)
1. [Highest impact migration first]
2. [Next...]
3. [Monitor: knowledge menu growth]
```

---

## Reference: Content Type Patterns

Quick lookup table for common content patterns in this codebase:

| Content pattern | Label | Rationale |
|----------------|-------|-----------|
| "You are a Figma AI plugin agent..." | WHAT | Identity declaration |
| "FIGMA ≠ CSS: auto-layout ≠ flexbox" | WHY | Mental model correction |
| "DESIGN THINKING 7 dimensions: LAYOUT, SIZING..." | WHY | Thinking framework |
| "Step 1: call jsx. Step 2: call describe..." | HOW | Ordered procedure |
| "`Frame corner:8 bg:#fff gap:12`" (inline example) | HOW | Specific-value example |
| "call knowledge() when uncertain about anatomy" | HOW | Procedure trigger |
| "4-step creation gate: measure → design → create → verify" | HOW | Checklist |
| "padding 29%→30% data shows..." | WHY | Empirical insight (not a rule) |
| "context budget = 70% of model window" | WHAT | Environmental constraint |

---

## Do NOT

- Edit SYSTEM.md or any source file during the audit (read-only)
- Move HOW content without verifying the target knowledge entry exists or is created first
- Remove a WHY section that anchors a HOW knowledge entry (the WHY stays; only the HOW details move)
- Count injected sections as part of SYSTEM.md totals (track them separately)
