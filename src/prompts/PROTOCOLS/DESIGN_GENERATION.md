## DESIGN GENERATION PROTOCOL

### BATCH CREATION (PREFERRED for new designs)
For creating NEW components, layouts, or pages: use `create_node` to output ALL nodes in a single hierarchy.

> **CRITICAL RESTRICTED USAGE**: When creating a new screen or component from scratch, try to output the entire structure in a single `create_node` call by nesting children. If you are asked to "modify", "update", "fix", or "add to" an existing design on the canvas, use `patch_node` or `create_node` referencing the existing parent id.

**How it works**:
1. Output a node with `type`, `name`, and `props`.
2. Nest children components using the `children` array: `children: [{ type, name, props }, ...]`
3. ALL styling (fills, padding, itemSpacing, fontSize, etc.) goes directly into the node's properties.
4. **Root Sizing**: ALWAYS provide explicit `width` and `height` for the root container (first node) to avoid default fallback dimensions and narrow container collapse.
5. **Typography Guidelines**: For `fontWeight` (style), prioritize `Regular`, `Medium`, and `Bold`. **AVOID** using `Semi Bold` or `SemiBold` as it frequently causes `FONT_FALLBACK` issues on many platforms.

**Example** — a polished card with child elements:
```json
{
  "type": "FRAME", 
  "name": "Card", 
  "layoutMode": "VERTICAL", 
  "itemSpacing": 16, 
  "padding": 24, 
  "fills": [{"type": "SOLID", "color": {"r": 1, "g": 1, "b": 1, "a": 1}}], 
  "cornerRadius": 16, 
  "width": 360, 
  "layoutSizingVertical": "HUG", 
  "effects": [{"type": "DROP_SHADOW", "color": {"r": 0, "g": 0, "b": 0, "a": 0.1}, "offset": {"x": 0, "y": 4}, "radius": 16, "spread": 0}],
  "children": [
    {
      "type": "TEXT", 
      "characters": "Card Title", 
      "fontSize": 20, 
      "fontWeight": "Bold", 
      "fills": [{"type": "SOLID", "color": {"r": 0.06, "g": 0.09, "b": 0.15, "a": 1}}], 
      "layoutSizingHorizontal": "FILL"
    },
    {
      "type": "TEXT",
      "characters": "Body text goes here",
      "fontSize": 14,
      "fills": [{"type": "SOLID", "color": {"r": 0.4, "g": 0.45, "b": 0.5, "a": 1}}],
      "layoutSizingHorizontal": "FILL"
    }
  ]
}
```

### MODIFICATION (for edits, additions to existing designs)
Use `patch_node` when:
- Modifying an EXISTING design's properties (not creating from scratch)
- Updating styling, text, or layout configurations

Use `create_node` when:
- Adding a single node to an existing parent on the canvas (specify `parentId`).

### INLINE STYLING (always)
ALWAYS include fills, cornerRadius, padding, itemSpacing, etc. in the SAME call that creates the node.
NEVER create a bare node and style it in a separate call.
