# Round 1 — REVERT

**Target:** spacingCompleteness
**Hypothesis:** The LLM treats SPACING as optional polish rather than a required structural dimension, leading to omitted padding and gap values.
**Decision:** REVERT

## Score Deltas
  layoutCompleteness: -1.1
  fillCompleteness: -3.0
  textCompleteness: 0.0
  sizingCompleteness: 0.0
  spacingCompleteness: -2.2
  toolEfficiency: 0.0
  errorFreeRate: -0.6
  composite: -1.0

## Edits Applied
- modify_rule in "The quality ladder": - **Functional** (dimensions 1–3): wireframe — structure, sizing, AND spacing (padding/gap cannot be zero/omitted on containers)
- **Standard** (+ 4): looks designed — visual surfaces with proper spacing rhythm
- add_rule in "Frame — 7 dimensions": SPACING is mandatory: every frame with children MUST have explicit `p` (padding) and `gap` values. Default to `p={16}` and `gap={12}` when unspecified by user.

## Reasoning
Regressions on: fillCompleteness -3.0

## Prompt Diff
```
diff --git a/src/prompts/CORE.md b/src/prompts/CORE.md
index 6fa1460..31fb412 100644
--- a/src/prompts/CORE.md
+++ b/src/prompts/CORE.md
@@ -52,6 +52,7 @@ For each node, make an explicit design decision on every applicable dimension.
 | 6 | **BORDER** | Visible edges | `stroke:'1 #E5E7EB'` |
 | 7 | **DEPTH** | Elevation | `shadow:'0,4,16,0,#0000001A'` |
 
+- SPACING is mandatory: every frame with children MUST have explicit `p` (padding) and `gap` values. Default to `p={16}` and `gap={12}` when unspecified by user.
 ### Text — 4 dimensions
 | # | Dimension | Think about... | Props |
 |---|---|---|---|
@@ -61,8 +62,8 @@ For each node, make an explicit design decision on every applicable dimension.
 | 4 | **OVERFLOW** | Long content handling | `textTruncation`, `maxLines` |
 
 ### The quality ladder
-- **Functional** (dimensions 1–2): wireframe — structure and sizing only
-- **Standard** (+ 3–4): looks designed — spacing rhythm + visual surfaces
+- **Functional** (dimensions 1–3): wireframe — structure, sizing, AND spacing (padding/gap cannot be zero/omitted on containers)
+- **Standard** (+ 4): looks designed — visual surfaces with proper spacing rhythm
 - **Polished** (+ 5–7): looks professional — rounded corners, shadows, borders
 
 Dimensions 1–4 define the design. Dimensions 5–7 add polish — omit when not needed.

```
