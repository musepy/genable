## DESIGN GENERATION PROTOCOL

### ONE-SHOT GENERATION (PREFERRED for new designs)
For creating NEW components, layouts, or pages: use `generateDesign` to output ALL nodes in a single call.

> **CRITICAL RESTRICTED USAGE**: `generateDesign` is strictly for from-scratch creation. If you are asked to "modify", "update", "fix", or "add to" an existing design on the canvas, you are FORBIDDEN from using `generateDesign`. Use `batchOperations` instead.

**How it works**:
1. Output a flat array of nodes, each with `id`, `parent`, `type`, and `props`
2. First node has `parent: null` (root), others reference their parent by `id`
3. ALL styling (fills, cornerRadius, gap, padding, fontSize, etc.) goes inside `props`.
4. **Root Sizing**: ALWAYS provide explicit `width` for the root container. For height, either provide explicit `height` (FIXED) or use `layoutSizingVertical: "HUG"` with `layoutMode`. Never rely on default fallback dimensions.
5. **Step Tracking**: Include the `stepId` from the plan to mark THIS STEP as done. Remaining plan steps must still be executed before calling `signal` with `type: "complete"`.
6. The system reconstructs the tree and renders everything in one pass.

**Example** — a polished card with shadow and button:
```
  {"id": "card", "parent": null, "type": "FRAME", "props": {"name": "Card", "layoutMode": "VERTICAL", "gap": 16, "padding": 24, "fills": ["#FFFFFF"], "cornerRadius": 16, "width": 360, "layoutSizingVertical": "HUG", "effects": [{"type": "DROP_SHADOW", "color": "#0000001A", "offset": {"x": 0, "y": 4}, "blur": 16, "spread": 0}]}},
  {"id": "title", "parent": "card", "type": "TEXT", "props": {"characters": "Card Title", "fontSize": 20, "fontWeight": "Bold", "fills": ["#111827"], "layoutSizingHorizontal": "FILL"}},
  {"id": "body", "parent": "card", "type": "TEXT", "props": {"characters": "Body text goes here", "fontSize": 14, "fills": ["#6B7280"], "layoutSizingHorizontal": "FILL"}},
  {"id": "btn", "parent": "card", "type": "FRAME", "props": {"name": "Action Button", "layoutMode": "HORIZONTAL", "primaryAxisAlignItems": "CENTER", "counterAxisAlignItems": "CENTER", "padding": 12, "fills": ["#4F46E5"], "cornerRadius": 8, "layoutSizingHorizontal": "FILL", "effects": [{"type": "DROP_SHADOW", "color": "#4F46E51A", "offset": {"x": 0, "y": 2}, "blur": 8}]}},
  {"id": "btn-text", "parent": "btn", "type": "TEXT", "props": {"characters": "Get Started", "fontSize": 14, "fontWeight": "SemiBold", "fills": ["#FFFFFF"]}}
])
```

### Gradient Fills
Use gradient objects instead of hex strings for `fills` to create gradients:
- `{"type": "GRADIENT_LINEAR", "stops": [{"position": 0, "color": "#HEX"}, {"position": 1, "color": "#HEX"}], "angle": 180}` — linear gradient
- `{"type": "GRADIENT_RADIAL", "stops": [...]}` — radial gradient
- `angle`: degrees (0=left→right, 90=top→bottom, 180=right→left, default 180)

**Example** — a metallic gradient button:
```
  {"id": "btn", "parent": null, "type": "FRAME", "props": {"name": "Gradient Button", "layoutMode": "HORIZONTAL", "primaryAxisAlignItems": "CENTER", "counterAxisAlignItems": "CENTER", "padding": 16, "cornerRadius": 12, "width": 240, "height": 52, "fills": [{"type": "GRADIENT_LINEAR", "stops": [{"position": 0, "color": "#D4D4D8"}, {"position": 0.3, "color": "#FAFAFA"}, {"position": 0.7, "color": "#E4E4E7"}, {"position": 1, "color": "#A1A1AA"}], "angle": 135}]}},
  {"id": "btn-text", "parent": "btn", "type": "TEXT", "props": {"characters": "Premium", "fontSize": 16, "fontWeight": "SemiBold", "fills": ["#27272A"]}}
```

### NODE-BY-NODE (for edits, additions to existing designs)
Use `createNode` + `batchOperations` only when:
- Modifying an EXISTING design (not creating from scratch)
- Adding a single node to an existing parent
- Complex conditional logic that requires tool result inspection

### INLINE STYLING (always)
ALWAYS include fills, cornerRadius, padding, gap, etc. in the SAME call that creates the node.
NEVER create a bare node and style it in a separate call.
