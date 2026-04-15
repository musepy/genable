# Round 3 — REVERT

**Target:** spacingCompleteness
**Hypothesis:** The LLM treats SPACING as optional polish rather than mandatory structure, causing it to omit padding and gap values when creating frames.
**Decision:** REVERT

## Score Deltas
  layoutCompleteness: -1.7
  fillCompleteness: -6.1
  textCompleteness: 0.0
  sizingCompleteness: 0.0
  spacingCompleteness: -4.4
  toolEfficiency: 0.0
  errorFreeRate: 0.0
  composite: -1.7

## Edits Applied
- modify_rule in "The quality ladder": - **Functional** (dimensions 1–3): wireframe — structure, sizing, AND spacing (padding/gap) required for all containers
- **Standard** (+ 4): looks designed — visual surfaces (bg, fill)
- **Polished** (+ 5–7): looks professional — rounded corners, shadows, borders
- add_rule in "Frame — 7 dimensions": **SPACING is non-optional**: Every frame with children MUST have explicit `p` (padding) and `gap` values. Default to `p={16}` and `gap={8}` when unspecified.

## Reasoning
Regressions on: fillCompleteness -6.1

## Prompt Diff
```
diff --git a/src/prompts/CORE.md b/src/prompts/CORE.md
index 6fa1460..5730074 100644
--- a/src/prompts/CORE.md
+++ b/src/prompts/CORE.md
@@ -52,6 +52,7 @@ For each node, make an explicit design decision on every applicable dimension.
 | 6 | **BORDER** | Visible edges | `stroke:'1 #E5E7EB'` |
 | 7 | **DEPTH** | Elevation | `shadow:'0,4,16,0,#0000001A'` |
 
+- **SPACING is non-optional**: Every frame with children MUST have explicit `p` (padding) and `gap` values. Default to `p={16}` and `gap={8}` when unspecified.
 ### Text — 4 dimensions
 | # | Dimension | Think about... | Props |
 |---|---|---|---|
@@ -61,8 +62,8 @@ For each node, make an explicit design decision on every applicable dimension.
 | 4 | **OVERFLOW** | Long content handling | `textTruncation`, `maxLines` |
 
 ### The quality ladder
-- **Functional** (dimensions 1–2): wireframe — structure and sizing only
-- **Standard** (+ 3–4): looks designed — spacing rhythm + visual surfaces
+- **Functional** (dimensions 1–3): wireframe — structure, sizing, AND spacing (padding/gap) required for all containers
+- **Standard** (+ 4): looks designed — visual surfaces (bg, fill)
 - **Polished** (+ 5–7): looks professional — rounded corners, shadows, borders
 
 Dimensions 1–4 define the design. Dimensions 5–7 add polish — omit when not needed.

```
