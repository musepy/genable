# Research Notes: Reasoning Layer Integration

**Date**: 2026-01-20
**Context**: Validating assumptions for the "Reasoning Layer" implementation plan using `ui-ux-pro-max-skill` data.

## 1. Source Data Analysis (`ui-reasoning.csv`)
- **Location**: `ui-ux-pro-max-skill/skills/ui-ux-pro-max/data/ui-reasoning.csv`
- **Volume**: ~102 Rules
- **Key Columns**:
    - `UI_Category` ("SaaS (General)", "Micro SaaS", etc.) - **Primary Key for Intent**
    - `Recommended_Pattern` ("Hero + Features + CTA") - Maps to Layout Structure.
    - `Style_Priority` ("Glassmorphism + Flat Design") - Maps to Visual Style.
    - `Decision_Rules` (JSON string) - Critical logical branch points (e.g., `{"if_data_heavy": "add-glassmorphism"}`).
    - `Severity` ("HIGH", "MEDIUM") - Priority level.

**Implication for Adapter**:
- The Adapter MUST parse the `Decision_Rules` column from stringified JSON to actual JSON objects during the build process.
- `UI_Category` contains hierarchical data (e.g., "Fintech/Crypto"). The adapter should probably tokenize this for better searchability.

## 2. Logic Mapping (`design_system.py`)
The Python implementation uses a tiered matching strategy (`_find_reasoning_rule`):
1.  **Exact Match**: `rule.category == query`
2.  **Partial Match**: `query in rule.category`
3.  **Keyword Match**: Token overlap.

**Migration Strategy to Minisearch**:
- `minisearch` supports fuzzy, prefix, and boosting.
- We can replicate the tiered logic by configuring `minisearch` with:
    - `fields`: `['category', 'keywords']`
    - `storeFields`: `['category', 'pattern', 'decision_rules', ...]`
    - **Boosting**: Give high boost to exact phrase matches in `category`.

## 3. Dependency Decision: Minisearch vs Fuse.js
- **Current State**: `fuse.js` is present in `package.json` but ONLY used in `src/_archive/ragService.ts`. It is effectively dead code in the active path.
- **Evaluation**:
    - `fuse.js`: Good for typo-tolerance in short strings.
    - `minisearch`: Better for full-text search, prefix matching, and structured field querying. It is more suitable for the "Intent-based" retrieval where we want to match "Fintech dashboard" against "B2B SaaS / Fintech".
- **Conclusion**: Proceed with **Minisearch** as planned. Remove `fuse.js` if possible (or keep for archive referencing) but do not use it for new logic.

## 4. Architecture Validation
- **Build-time Adapter**: Validated. `ui-reasoning.csv` is static and versioned. Pre-processing it into `src/generated/reasoning.json` (or similar) is optimal for performance and type safety.
- **Type Generation**: The adapter should generating a TypeScript interface `ReasoningRule` matching the CSV structure to ensure the runtime code is type-safe.

## 5. Next Steps
1.  **Install**: `minisearch`, `csv-parse` (dev dependency).
2.  **Scaffold**: Create `scripts/adapter.ts`.
3.  **Implement**: Logic to read CSV -> Parse JSON col -> Write `.ts` file.
