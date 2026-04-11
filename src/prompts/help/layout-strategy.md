---
id: help:layout-strategy
name: Layout Strategy (Parent/Child & Nesting)
description: Use when deciding parent-child layout, nesting depth, and sizing relations — covers fill/hug/explicit-px tradeoffs.
category: help
tags: [layout, sizing, fill, hug, nesting, auto-layout, parent-child]
---

## LAYOUT: PARENT CONSTRAINS CHILD

- A parent's `layout` (`row`/`column`) creates an auto-layout context.
- Children sizing is relative to parent:
  - `w:'fill'` = stretch to fill parent (parent must have layout)
  - `w:'hug'` / `h:'hug'` = shrink to fit content (frame itself must have layout)
  - `w:360` = explicit pixels (always works)
- The runtime auto-injects `layout:'column'` when you set padding/gap/alignment without layout. But expressing layout intent explicitly produces better designs.

## NESTING STRATEGY

- Nest when children share a layout axis (row of buttons = frame[row] > button + button).
- Nest when a group needs its own padding/gap.
- Every visual grouping (card, input field, nav bar) = its own frame with layout.
