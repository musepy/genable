# Round 4 — REVERT

**Target:** spacingCompleteness
**Hypothesis:** The LLM omits padding and gap values because the 'quality ladder' suggests spacing is optional for 'Functional' designs, and there's no explicit requirement to always set spacing on containers.
**Decision:** REVERT

## Score Deltas
  layoutCompleteness: -2.0
  fillCompleteness: -5.9
  textCompleteness: 0.0
  sizingCompleteness: 0.0
  spacingCompleteness: -3.9
  toolEfficiency: 0.0
  errorFreeRate: +1.7
  composite: -1.5

## Edits Applied
- modify_rule in "The quality ladder": - **Functional** (dimensions 1–3): wireframe — structure, sizing, and minimum spacing (p≥16, gap≥8 on all containers)
- **Standard** (+ 4): looks designed — refined spacing rhythm + visual surfaces
- add_rule in "Frame — 7 dimensions": SPACING is MANDATORY: Every frame with children MUST have explicit `p` (padding) and `gap` values. Default to `p={16}` and `gap={8}` when unspecified.

## Reasoning
Regressions on: fillCompleteness -5.9

## Prompt Diff
```
diff --git a/src/prompts/CORE.md b/src/prompts/CORE.md
index 6fa1460..f53d1cd 100644
--- a/src/prompts/CORE.md
+++ b/src/prompts/CORE.md
@@ -52,6 +52,7 @@ For each node, make an explicit design decision on every applicable dimension.
 | 6 | **BORDER** | Visible edges | `stroke:'1 #E5E7EB'` |
 | 7 | **DEPTH** | Elevation | `shadow:'0,4,16,0,#0000001A'` |
 
+- SPACING is MANDATORY: Every frame with children MUST have explicit `p` (padding) and `gap` values. Default to `p={16}` and `gap={8}` when unspecified.
 ### Text — 4 dimensions
 | # | Dimension | Think about... | Props |
 |---|---|---|---|
@@ -61,8 +62,8 @@ For each node, make an explicit design decision on every applicable dimension.
 | 4 | **OVERFLOW** | Long content handling | `textTruncation`, `maxLines` |
 
 ### The quality ladder
-- **Functional** (dimensions 1–2): wireframe — structure and sizing only
-- **Standard** (+ 3–4): looks designed — spacing rhythm + visual surfaces
+- **Functional** (dimensions 1–3): wireframe — structure, sizing, and minimum spacing (p≥16, gap≥8 on all containers)
+- **Standard** (+ 4): looks designed — refined spacing rhythm + visual surfaces
 - **Polished** (+ 5–7): looks professional — rounded corners, shadows, borders
 
 Dimensions 1–4 define the design. Dimensions 5–7 add polish — omit when not needed.

```
