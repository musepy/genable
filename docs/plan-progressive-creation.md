# Plan: Progressive Creation & Template Expansion

## Background

Testing revealed:
- LLM one-shot outputs 13K chars XML (115 nodes) for a landing page — works but risky for complex designs
- Pencil forces progressive creation via: guidelines skeleton + placeholder containers + 25 ops/call hard limit
- Component system works (cross-turn ref verified), but LLM rarely uses `<ref>` across separate tool calls
- `reusable='true'` + `<ref>` should work as template expansion (→ FRAME copy), not only as Figma COMPONENT+INSTANCE

## Tasks

### T1: Create tool node limit (Hard constraint)
**File**: `src/engine/actions/xmlDesignParser.ts` or `src/engine/actions/compiler.ts`
**Change**: If parsed XML exceeds N nodes (e.g., 25), return error with message: "Too many nodes (X). Split into multiple create calls — first create the skeleton with placeholder containers, then fill each section separately."
**Effect**: LLM physically cannot one-shot a 115-node page, forced to split.

### T2: Template expansion mode (ref → FRAME copy)
**File**: `src/engine/actions/executor.ts` — `createInstance` case
**Change**: Default behavior for `<ref>`: instead of `master.createInstance()`, clone the component's children into a new FRAME, apply overrides. Only create real INSTANCE when a `componentize='true'` flag is present.
**Effect**: LLM uses ref syntax for deduplication/quality, but output is regular FRAMEs. Real components only when user explicitly requests.

### T3: Landing page guidelines
**File**: `src/generated/guidelines-catalog.json` (via source markdown)
**Change**: Add structured landing page guidelines inspired by Pencil's approach:
- 10-section standard structure (Header → Hero → Features → ... → Footer)
- Implementation entry point showing skeleton-first pattern
- Section-by-section fill examples
**Effect**: When LLM queries `query_knowledge("guidelines", "landing-page")`, gets progressive creation guidance.

### T4: WORKFLOW.md progressive creation rules
**File**: `src/prompts/WORKFLOW.md`
**Change**: Strengthen PROGRESSIVE CREATION section:
- "For designs with 5+ sections: create skeleton first (placeholder containers), then fill each section in separate create calls"
- "Between sections, use read(screenshot) to verify before continuing"
- Show before/after example of skeleton → fill pattern
**Effect**: System prompt reinforces the pattern from T1/T3.

### T5: Responsive design support (future)
**Depends on**: T1-T4 working
**Change**: Add prompt guidance for multi-breakpoint workflow:
- Define shared components (feature card, testimonial, etc.)
- Create breakpoint containers (desktop 1440, tablet 768, mobile 375)
- Ref shared components with layout overrides per breakpoint
**Effect**: 3-breakpoint responsive from ~39K chars down to ~10K chars.

## Priority Order

1. **T1** (node limit) — highest impact, simplest change, forces behavior immediately
2. **T3** (guidelines) — provides the "what to build" structure
3. **T4** (WORKFLOW.md) — reinforces progressive pattern in system prompt
4. **T2** (template expansion) — needed for T5, but current ref→INSTANCE also works
5. **T5** (responsive) — depends on all above

## Already Done (this session)

- [x] `componentRegistry` — cross-batch symbol resolution (module-level Map)
- [x] `resolveComponent()` — resolution chain: tempIdMap → componentRegistry → raw ID
- [x] `clipsContent` default — auto-layout frames default to false
- [x] Multi-screenshot export — per-root-node screenshots in dev bridge
- [x] Anti-overlap positioning — new root nodes placed right of existing content
- [x] Dev bridge server cleanup — auto-cleanup keeps 5 most recent results
