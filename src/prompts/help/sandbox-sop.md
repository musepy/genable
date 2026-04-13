---
id: help:sandbox-sop
name: Sandbox Rules and Component SOPs
description: Use when using the js tool, converting frames to components/instances, hitting Blocked/parenting-cycle errors, or planning multi-step component-to-instance replacement workflows.
category: help
tags: [js, sandbox, component, instance, sop, workflow]
---

## SANDBOX RULES (js tool)

The `js` tool executes code in the Figma plugin main thread. These patterns are **blocked** — use dedicated tools instead:

| Blocked pattern | Why | Use instead |
|---|---|---|
| `.remove()` | Prevent bulk deletion | `delete_node({node: "1:2"})` |
| `.removeChild()` | Prevent child removal | `delete_node` |
| `.insertChild()` | Prevent structure mutation | `move_node({node, dest, index})` |
| `figma.root` | Block document traversal | `find_nodes({query})` |
| `figma.currentPage.children` | Block page-level bulk access | `find_nodes({query})` |
| `eval`, `Function()`, `import()` | Sandbox escape prevention | N/A |

### js tool — DO and DON'T

**DO** — use `js` for:
- Reading node properties: `js({code: "const n = await figma.getNodeByIdAsync('1:2'); return {type: n.type, name: n.name}"})`
- Traversing children of a known node: `const comp = await figma.getNodeByIdAsync("1:2"); return comp.children.map(c => ({id: c.id, name: c.name, type: c.type}))`
- Batch reads that dedicated tools can't do efficiently
- `figma.createComponent()` + property copy (when building helper components)

**DON'T** — these will be blocked:
- `node.remove()` → use `delete_node`
- `parent.insertChild(idx, child)` → use `move_node({node, dest, index})`
- `figma.currentPage.children` → use `find_nodes({query})`
- `figma.root` → use `find_nodes` or `inspect({node: "/"})`

### Async API rule
Always use `figma.getNodeByIdAsync()` (not `figma.getNodeById()`).
The plugin runs in `documentAccess: dynamic-page` mode — synchronous API throws.

---

## COMPONENT OPERATIONS — Standard Workflows

### SOP 1: Convert a frame to component (top-level frame)
```
create_component({node: "1:2"})
→ returns {nodeId: "1:99"}  ← THIS IS THE NEW COMPONENT ID
```
**Rule**: The original frame ID ("1:2") becomes INVALID after conversion. Always use the returned `nodeId` for subsequent operations.

### SOP 2: Create instances of an existing component
```
create_instance({node: "1:99"})                    → instance on page
create_instance({node: "1:99", parent: "1:50"})    → instance inside a parent
```

### SOP 3: Add component properties
```
add_component_prop({node: "1:99", name: "Title", type: "TEXT", default: "Hello", bind: "1:100"})
add_component_prop({node: "1:99", name: "Show Icon", type: "BOOLEAN", default: "true", bind: "1:101"})
```

---

## CRITICAL SOP: Replace frame inside a component with a component instance

This is the hardest workflow. Figma does NOT allow nested components (component inside component). Follow this exact sequence:

### Problem scenario
You have a `Login Form` component containing icon frames (Logo Icon, Email Icon, etc.) and you want to make them reusable component instances.

### Step-by-step SOP

**Phase 1: Extract icon as external component**
```
1. clone_node({node: "<icon-frame-id>", dest: "/<Icon Name>"})
   → returns {idMap: {"<Icon Name>": "<clone-id>"}}

2. create_component({node: "<clone-id>"})
   → returns {nodeId: "<NEW-COMPONENT-ID>"}   ⚠️ SAVE THIS ID!
```

**Phase 2: Create instance and place inside parent component**
```
3. create_instance({node: "<NEW-COMPONENT-ID>", parent: "<icon-parent-id>"})
   → returns {nodeId: "<instance-id>"}

4. delete_node({node: "<original-icon-frame-id>"})
```

**Phase 3: Reorder if needed**
```
5. move_node({node: "<instance-id>", index: 0})
   → places instance at correct position
```

### FULL EXAMPLE (5 icons in Login Form)
```
// --- Logo Icon ---
clone_node({node: "1:37", dest: "/Logo Icon"})          → clone: "1:62"
create_component({node: "1:62"})                         → comp: "1:66"
create_instance({node: "1:66", parent: "1:36"})          → inst: "1:70"
delete_node({node: "1:37"})                              → remove original
move_node({node: "1:70", index: 0})                      → reorder to first child

// --- Email Icon ---
clone_node({node: "1:47", dest: "/Email Icon"})          → clone: "1:72"
create_component({node: "1:72"})                         → comp: "1:76"
create_instance({node: "1:76", parent: "1:46"})          → inst: "1:80"
delete_node({node: "1:47"})
move_node({node: "1:80", index: 0})
```

### Common errors and fixes

| Error | Cause | Fix |
|---|---|---|
| "Cannot move node. Reparenting would create a component inside a component" | `create_component` on a node already inside a COMPONENT | Clone node OUT first (to page level), then convert the clone |
| "Node X not found" after `create_component` | Used the OLD frame ID instead of the NEW component ID | Always read `nodeId` from `create_component` response — that's the new ID |
| "X is a FRAME, not a component" on `create_instance` | The frame wasn't actually converted to a component | Verify with `inspect({node: "<id>"})` — check `type` field is `COMPONENT` |
| "Doing so would create a parenting cycle" on `move_node` | Tried to move a component into its own instance | Instances are created separately — don't move the component itself into a child |

### ID tracking rule (CRITICAL)
Every `create_component` call **changes the node ID**. Track IDs carefully:

```
Original frame:   "1:37" (will be DELETED by create_component)
Clone of frame:   "1:62" (will be DELETED by create_component)
New component:    "1:66" ← USE THIS for create_instance
New instance:     "1:70" ← USE THIS for move_node
```

Never reuse an ID from a previous step if that node was consumed by `create_component` or `delete_node`.

---

## ITERATION BUDGET AWARENESS

Component ↔ instance operations require multiple sequential steps. Budget your iterations:

| Operation | Steps needed |
|---|---|
| Convert 1 frame to component | 1 step |
| Add 1 component property | 1 step |
| Replace 1 icon frame → instance | 4-5 steps (clone + convert + instance + delete + reorder) |
| Replace 5 icons → instances | 20-25 steps |

**If budget is low (< 10 remaining)**: Stop icon-to-instance conversion. Tell the user what was completed and what remains. Retrying the same failed call with identical parameters wastes budget — change approach or stop.

**Escalation rule**: If the same error occurs twice, change approach or stop. Do NOT retry the same call with the same parameters.
