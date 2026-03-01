---
id: figma-core
name: Figma Core Operations
description: Create, modify, and inspect Figma nodes
category: figma
priority: 1
injectionType: system
tools:
  - create_node
  - patch_node
  - read_node
  - delete_node
  - query_knowledge
  - validate_design
  - signal
enabledByDefault: true
---

## FIGMA OPERATIONS

### PREFERRED: One-Shot Generation

For creating NEW components/layouts, use `create_node` — output ALL nodes in one call using a flat list with `id` and `parent` references.

> [!IMPORTANT]
> Even if your plan has multiple steps (e.g., 1. Header, 2. Form, 3. Footer), you should ideally use **ONE** `create_node` call to output the entire tree at once. This ensures consistency and is much faster.

```json
create_node({
  "nodes": [
    {"id": "card", "type": "FRAME", "props": {"name": "Card", "layoutMode": "VERTICAL", "gap": 12, "padding": 16, "fills": ["#FFFFFF"], "cornerRadius": 12}},
    {"id": "title", "parent": "card", "type": "TEXT", "props": {"characters": "Card Title", "fontSize": 18, "fontWeight": "Bold"}},
    {"id": "desc", "parent": "card", "type": "TEXT", "props": {"characters": "Description text", "fontSize": 14, "fills": ["#6B7280"]}}
  ]
})
```

This is faster and more reliable than creating nodes one-by-one.

### MODIFICATION (PREFERRED)

For high-level modification, use `patch_node`. This avoids atomic loops and is much more token-efficient.

#### patch_node (Modify State)
Incrementally update an element by merging properties. Preserves children automatically.
```json
patch_node({
  "patches": [
    {
      "nodeId": "123:456",
      "props": {"fills": ["#EF4444"], "padding": 16}
    }
  ]
})
```

### Key Rules
- **create_node**: First node without `parent` is the root. All others reference parent by temporary `id`.
- **All props in `props`**: layoutMode, gap, fills, fontSize, cornerRadius, effects, etc.
- **TEXT nodes MUST have characters**
- **Meaningful names**: Never use "unnamed" or "frame"
- **Auto Layout for HUG**: Add layoutMode before using HUG sizing
- **Effects**: Use effects for visual depth. Example:
  ```json
  "effects": [{"type": "DROP_SHADOW", "color": "#0000001A", "offset": {"x": 0, "y": 4}, "blur": 16, "spread": 0}]
  ```
  Types: DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR
- **Colors**: Use non-pure-black for text (#111827), subtle borders (#D1D5DB) for inputs

### Error & Warning Recovery
- **`PARENT_NOT_FOUND` Error** → Create parent first.
- **`NODE_NOT_FOUND` Error** → Use `read_node` or `inspectDesign` to find valid IDs.
- **`FONT_FALLBACK` Warning** → **DO NOT** repeat `create_node`. If it's a critical text element (e.g., Title or Button), use `patch_node` ONCE to attempt using an available `fontWeight` (like `Regular` or `Medium`). If it fails again, proceed with the task and summarize unresolved `warningsDigest` in the final `signal({ type: "complete", ... })` call.
