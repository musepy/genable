---
id: figma-core
name: Figma Core Operations
description: Create, modify, and inspect Figma nodes
category: figma
priority: 1
injectionType: system
tools:
  - planDesign
  - generateDesign
  - inspectDesign
  - createNode
  - setNodeLayout
  - setNodeStyles
  - createIcon
  - updateNodeProperties
  - deleteNode
  - applyDesignPatch
  - validateLayout
enabledByDefault: true
---

## FIGMA OPERATIONS

### PREFERRED: One-Shot Generation

For creating NEW components/layouts, use `generateDesign` — output ALL nodes in one call. 

> [!IMPORTANT]
> Even if your plan has multiple steps (e.g., 1. Header, 2. Form, 3. Footer), you should ideally use **ONE** `generateDesign` call to output the entire tree at once. This ensures consistency and is much faster.

```json
generateDesign({nodes: [
  {"id": "card", "parent": null, "type": "FRAME", "props": {"name": "Card", "layoutMode": "VERTICAL", "gap": 12, "padding": 16, "fills": ["#FFFFFF"], "cornerRadius": 12}},
  {"id": "title", "parent": "card", "type": "TEXT", "props": {"characters": "Card Title", "fontSize": 18, "fontWeight": "Bold"}},
  {"id": "desc", "parent": "card", "type": "TEXT", "props": {"characters": "Description text", "fontSize": 14, "fills": ["#6B7280"]}}
]})
```

This is faster and more reliable than creating nodes one-by-one.

### Node-by-Node (for edits only)

Use `createNode` / `setNodeLayout` / `setNodeStyles` only for modifying existing designs or adding single nodes.

### Key Rules
- **generateDesign**: First node must have `parent: null` (root). All others reference parent by id.
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

### Error Recovery
- `PARENT_NOT_FOUND` → Create parent first
- `NODE_NOT_FOUND` → Use inspectDesign to find valid IDs
- `RECONSTRUCTION_FAILED` → Check parent references in nodes array
