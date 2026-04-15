---
id: help:creation-flow
name: Creation Flow (4-Step Gate)
description: "Use when starting a jsx creation task — section-by-section workflow: jsx one block, describe to verify, edit or re-jsx to fix, repeat. Load before first jsx call."
category: help
tags: [jsx, describe, creation, verification, gate, workflow]
---

## CREATION FLOW (MANDATORY)

Build page-by-page, section-by-section: one jsx per logical block (a card, a section, a component set), not one jsx for an entire page. After each jsx block: inspect/describe, then refine with edit/setters.

Delete-and-recreate is allowed when structure is fundamentally wrong (edit can't fix broken nesting or wrong layout direction).

### The section loop (per block)

1. **`jsx`** — create one section or component (not the whole page)
2. **`describe`** — ALWAYS run after jsx on the created section. **NOT optional.**
3. If describe reports issues:
   - Property-level (wrong padding, color, size) → `edit`/setters to fix → `describe` again
   - Structural (wrong nesting, layout direction, broken layout) → re-jsx the affected subtree, then `describe`
4. Move to the next section, or respond with text once all sections pass describe

**Skipping step 2 produces designs with missing padding, broken layout, and invisible spacing.**
