## DESIGN GENERATION PROTOCOL

### ONE-SHOT GENERATION (PREFERRED for new designs)
For creating NEW components, layouts, or pages: use `build_design` to output ALL nodes in a single call.

> **CRITICAL RESTRICTED USAGE**: `build_design` is strictly for from-scratch creation. If you are asked to "modify", "update", "fix", or "add to" an existing design on the canvas, you are FORBIDDEN from using `build_design`. Use `patch_node` instead.

**How it works**:
1. Pass an `operations` array where each element is one command (create, update, delete, icon, image)
2. First node has no parent (root), others reference their parent by symbol
3. ALL styling (fills, cornerRadius, gap, padding, fontSize, etc.) goes inside props.
4. **Root Sizing**: ALWAYS provide explicit `width` for the root container. For height, either provide explicit `height` (FIXED) or use `layoutSizingVertical: "HUG"` with `layoutMode`. Never rely on default fallback dimensions.
5. **Step Tracking**: Include the `stepId` from the plan to mark THIS STEP as done. Remaining plan steps must still be executed before calling `signal` with `type: "complete"`.
6. The system reconstructs the tree and renders everything in one pass.

**Example** — a polished card with shadow and button:
```json
build_design({
  "operations": [
    { "op": "create", "symbol": "card", "type": "FRAME", "props": { "name": "Card", "layoutMode": "VERTICAL", "itemSpacing": 16, "padding": 24, "fills": ["#FFFFFF"], "cornerRadius": 16, "width": 360, "layoutSizingVertical": "HUG", "effects": [{"type":"DROP_SHADOW","color":"#0000001A","offset":{"x":0,"y":4},"radius":16}] } },
    { "op": "create", "symbol": "title", "type": "TEXT", "parent": "card", "props": { "characters": "Card Title", "fontSize": 20, "fontWeight": "Bold", "fills": ["#111827"], "layoutSizingHorizontal": "FILL" } },
    { "op": "create", "symbol": "body", "type": "TEXT", "parent": "card", "props": { "characters": "Body text goes here", "fontSize": 14, "fills": ["#6B7280"], "layoutSizingHorizontal": "FILL" } },
    { "op": "create", "symbol": "btn", "type": "FRAME", "parent": "card", "props": { "name": "Action Button", "layoutMode": "HORIZONTAL", "primaryAxisAlignItems": "CENTER", "counterAxisAlignItems": "CENTER", "padding": 12, "fills": ["#4F46E5"], "cornerRadius": 8, "layoutSizingHorizontal": "FILL" } },
    { "op": "create", "symbol": "btnText", "type": "TEXT", "parent": "btn", "props": { "characters": "Get Started", "fontSize": 14, "fontWeight": "Bold", "fills": ["#FFFFFF"] } }
  ]
})
```

### Gradient Fills
Use gradient objects instead of hex strings for `fills` to create gradients:
- `{"type": "GRADIENT_LINEAR", "stops": [{"position": 0, "color": "#HEX"}, {"position": 1, "color": "#HEX"}], "angle": 180}` — linear gradient
- `{"type": "GRADIENT_RADIAL", "stops": [...]}` — radial gradient
- `angle`: degrees (0=left→right, 90=top→bottom, 180=right→left, default 180)

### EDITING EXISTING DESIGNS
Use `read_node` + `patch_node` when:
- Modifying an EXISTING design (not creating from scratch)
- Adding a single node to an existing parent
- Complex conditional logic that requires tool result inspection

### INLINE STYLING (always)
ALWAYS include fills, cornerRadius, padding, gap, etc. in the SAME operation that creates the node.
NEVER create a bare node and style it in a separate call.
