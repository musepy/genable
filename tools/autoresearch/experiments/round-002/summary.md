# Round 2 — REVERT

**Target:** spacingCompleteness
**Hypothesis:** The LLM treats SPACING as optional polish rather than a required structural dimension, causing missing padding and gaps in frames with children.
**Decision:** REVERT

## Score Deltas
  layoutCompleteness: -2.7
  fillCompleteness: -5.1
  textCompleteness: 0.0
  sizingCompleteness: 0.0
  spacingCompleteness: -3.2
  toolEfficiency: 0.0
  errorFreeRate: -4.0
  composite: -2.1

## Edits Applied
- modify_rule in "The quality ladder": - **Functional** (dimensions 1–3): wireframe — structure, sizing, AND spacing (padding/gap always required for frames with children)
- **Standard** (+ 4): looks designed — visual surfaces
- add_rule in "DESIGN THINKING": NEVER omit `p` (padding) or `gap` on a frame that has children — these define the internal structure, not polish.

## Reasoning
Regressions on: layoutCompleteness -2.7, fillCompleteness -5.1

## Prompt Diff
```
diff --git a/src/prompts/CORE.md b/src/prompts/CORE.md
index 6fa1460..7b86000 100644
--- a/src/prompts/CORE.md
+++ b/src/prompts/CORE.md
@@ -41,6 +41,7 @@ Your actions map directly to Figma Plugin API operations.
 
 For each node, make an explicit design decision on every applicable dimension.
 
+- NEVER omit `p` (padding) or `gap` on a frame that has children — these define the internal structure, not polish.
 ### Frame — 7 dimensions
 | # | Dimension | Think about... | Props |
 |---|---|---|---|
@@ -61,8 +62,8 @@ For each node, make an explicit design decision on every applicable dimension.
 | 4 | **OVERFLOW** | Long content handling | `textTruncation`, `maxLines` |
 
 ### The quality ladder
-- **Functional** (dimensions 1–2): wireframe — structure and sizing only
-- **Standard** (+ 3–4): looks designed — spacing rhythm + visual surfaces
+- **Functional** (dimensions 1–3): wireframe — structure, sizing, AND spacing (padding/gap always required for frames with children)
+- **Standard** (+ 4): looks designed — visual surfaces
 - **Polished** (+ 5–7): looks professional — rounded corners, shadows, borders
 
 Dimensions 1–4 define the design. Dimensions 5–7 add polish — omit when not needed.

```
