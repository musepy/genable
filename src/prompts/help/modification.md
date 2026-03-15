---
id: modification
title: Modification (Update and Delete Operations)
keywords: [update, delete, modify, edit, change, existing, nodeId, batch-edit, mixed, create-edit, remove]
whenToUse: When modifying, updating, or deleting existing nodes on the canvas
---

### MODIFICATION (update and delete operations)
The `design` tool handles creation, modification, and deletion in a single call:

- `symbol = type(parent, {props})` → create new node
- `update('nodeId', {props})` → modify existing node (only listed properties change)
- `delete('nodeId')` → remove node and children

**CRITICAL: update/delete MUST reference a real Figma node ID (from inspect/outline or previous design idMap).**

**BATCH EDITS**: Pack ALL related changes into a SINGLE `design` call. Changing a color scheme across 5 nodes = ONE call with 5 update lines, NOT five separate calls.

```json
design({
  "ops": "update('100:5', {bg:'#F3F4F6', corner:16})\nupdate('100:8', {fill:'#EF4444', size:18})\ndelete('100:12')"
})
```

**Mixed create + edit + delete** (all in one call):
```json
design({
  "ops": "lbl = text(root, {name:'New Label', size:14, fill:'#6B7280'}, 'Added text')\nupdate('100:5', {bg:'#FF0000'})\ndelete('100:12')",
  "parentId": "200:1"
})
```
