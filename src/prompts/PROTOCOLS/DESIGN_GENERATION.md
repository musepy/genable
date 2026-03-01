## DESIGN GENERATION PROTOCOL

### BATCH CREATION (PREFERRED for new designs)
For creating NEW components, layouts, or pages: use `build_design` to output ALL nodes in a single DSL script.

> **CRITICAL RESTRICTED USAGE**: When creating a new screen or component from scratch, output the entire structure in a single `build_design` call. If you are asked to "modify", "update", "fix", or "add to" an existing design on the canvas, use `patch_node` or `build_design` referencing the existing parent id.

**How it works**:
1. Each line creates/updates/deletes one node using DSL syntax.
2. Bind symbols: `card = create(FRAME, { ... })`
3. Reference parents: `title = create(TEXT, parent=card, { ... })`
4. ALL styling goes into the props object on the same line.
5. **Root Sizing**: ALWAYS provide explicit `width` and `layoutSizingVertical: "HUG"` for the root container to avoid 100×100px fallback.
6. **Typography Guidelines**: For `fontWeight`, prioritize `Regular`, `Medium`, and `Bold`. **AVOID** `Semi Bold` or `SemiBold`.

**Example** — a polished card:
```
card = create(FRAME, { name: "Card", layoutMode: "VERTICAL", itemSpacing: 16, padding: 24, fills: ["#FFFFFF"], cornerRadius: 16, width: 360, layoutSizingVertical: "HUG", effects: [{"type":"DROP_SHADOW","color":"#0000001A","offset":{"x":0,"y":4},"radius":16}] })
title = create(TEXT, parent=card, { characters: "Card Title", fontSize: 20, fontWeight: "Bold", fills: ["#111827"], layoutSizingHorizontal: "FILL" })
body = create(TEXT, parent=card, { characters: "Body text goes here", fontSize: 14, fills: ["#6B7280"], layoutSizingHorizontal: "FILL" })
```

### MODIFICATION (for edits, additions to existing designs)
Use `patch_node` when:
- Modifying an EXISTING design's properties (not creating from scratch)
- Updating styling, text, or layout configurations

Use `build_design` when:
- Adding new nodes to an existing parent on the canvas (specify `parentId` param or use real node IDs as parent).

### INLINE STYLING (always)
ALWAYS include fills, cornerRadius, padding, itemSpacing, etc. in the SAME create line.
NEVER create a bare node and style it in a separate call.
