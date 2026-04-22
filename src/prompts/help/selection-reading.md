---
id: help:selection-reading
name: Selection Reading Strategy
description: Use when the user message contains a <selected_nodes> block — explains how to read the referenced nodes at appropriate depth without exhausting the context window.
category: help
tags: [selection, inspect, describe, screenshot, depth, context]
---

## SELECTION CONTEXT FORMAT

When the user attaches Figma canvas selection, the prompt is prefixed with:

```
<selected_nodes>
[{"id":"1:23","name":"Hero Card","type":"FRAME"},{"id":"1:24","name":"Button","type":"INSTANCE"}]
</selected_nodes>
```

This is a **reference**, not a snapshot. Nodes are NOT pre-expanded. You must call `inspect` / `describe` / `screenshot` to read details.

## READ STRATEGY

Start shallow, go deep only when the task demands it. Default budget: one `inspect(depth=2)` per referenced node is usually enough to understand structure.

### Step 1 — Identify task intent

- "describe / summarize this" → `describe(node, depth=2)` on each
- "modify / adjust X" → `inspect(node, depth=1)` + targeted `setter` calls
- "match visual pattern from this" → `inspect(node, depth=2)` + `screenshot(node)` for color/typography confirmation
- "what's inside this?" → `inspect(node, depth=3)`, recurse into children with more inspect calls only if needed

### Step 2 — Pick depth per node

| Intent | Depth | Rationale |
|---|---|---|
| Confirm structure | 1 | Root + direct children names/types |
| Understand layout | 2 | Enough to see padding/gap/auto-layout |
| Style matching | 2 + screenshot | Visuals beat JSON for color/typography |
| Deep editing | 3 or recurse | Only when the task needs leaf-level access |

Never default to full-depth dump. A 20-node tree at full depth easily exceeds 3K tokens per node.

### Step 3 — Very large nodes (>5000px or >100 descendants)

- Don't try to screenshot the whole thing; Figma export caps at ~4096px.
- Instead: `inspect(depth=1)` to see immediate children, then pick one child to recurse into.
- For visual confirmation: `screenshot(childNodeId)` on a representative section.

### Step 4 — Very small / empty nodes

- If `inspect` shows `children: []` and you have the name + type, don't call `screenshot` — the metadata is enough.
- For a leaf TEXT node, `inspect` returns characters, fill, fontSize, fontWeight — usually complete without screenshot.

## DON'T

- Don't call `get_selection` when `<selected_nodes>` is already present. The IDs in the block are authoritative.
- Don't screenshot every selected node up front — the user likely wants one specific answer, not a full inventory.
- Don't recurse into children by ID unless a specific child is relevant to the task.
