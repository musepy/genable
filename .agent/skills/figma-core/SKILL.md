---
id: figma-core
name: Figma Core Operations
description: Create, modify, and inspect Figma nodes
category: figma
priority: 1
injectionType: system
tools:
  - planDesign
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

You can create and modify Figma designs using these tools:

### Creation Flow
1. `createNode` → Create FRAME, TEXT, or other node types
2. `setNodeLayout` → Configure Auto Layout (VERTICAL/HORIZONTAL)
3. `setNodeStyles` → Apply fills, strokes, corner radius

### Key Rules
- **Parent-first**: Create parent nodes before children
- **Use returned IDs**: Always use nodeId from createNode response
- **Auto Layout for HUG**: Add layoutMode before using HUG sizing
- **Meaningful names**: Never use "unnamed" or "frame"
- **Text content**: Every TEXT node needs characters

### Error Recovery
- `PARENT_NOT_FOUND` → Create parent first
- `NODE_NOT_FOUND` → Use inspectDesign to find valid IDs
- `INVALID_SIZING` → Add layoutMode in same call

### Examples

**Create a card with title:**
```
createNode({type: "FRAME", name: "Card"})
→ {nodeId: "100:1"}

createNode({type: "TEXT", name: "Title", parentId: "100:1", characters: "Card Title"})
→ {nodeId: "100:2"}

setNodeLayout({nodeId: "100:1", layoutMode: "VERTICAL", gap: 12})
```

**Optimize selected element:**
```
inspectDesign()
→ {selection: [{id: "123:456", ...}]}

setNodeLayout({nodeId: "123:456", layoutMode: "VERTICAL", padding: {...}})
```
