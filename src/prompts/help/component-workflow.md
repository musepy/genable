---
id: help:component-workflow
name: Component Workflow
description: Use when creating reusable components, converting frames to components, assembling designs with instances, or adding component properties (TEXT/BOOLEAN/INSTANCE_SWAP).
category: help
tags: [component, instance, create_component, add_component_prop, override, workflow]
---

## COMPONENT WORKFLOW

Atomic components are built at canvas top level first; pages assemble them via `<instance ref="..."/>`. Ordering is structural, not stylistic: Figma's API rejects nested components (a component inside another component fails with "Cannot move node. Reparenting would create a component inside a component"). Top-level-first keeps the path atomic.

### The 4-step flow

**Step 1 — Create atomic components** (1 jsx call)

```jsx
jsx({markup: `
<component name="Text Input" w={356} layout="column" gap={8}>
  <text name="Label" size={14} weight="Medium">Label</text>
  <frame name="Input Box" w="fill" h={44} rounded={8} stroke="#D1D5DB" layout="row" align="center" p={{left:16, right:16}}>
    <text name="Placeholder" size={14} fill="#9CA3AF">Placeholder</text>
  </frame>
</component>

<component name="Button" w={356} h={48} rounded={8} bg="#4F46E5" layout="row" justify="center" align="center">
  <text name="Label" size={16} weight="SemiBold" fill="#FFFFFF">Button</text>
</component>
`})
```

Multiple `<component>` elements in one jsx call. All land at canvas top level.

**Step 2 — Add component properties** (inspect + add_component_prop)

```
inspect({node: componentId, depth: 3})  // get child IDs (skeleton)
add_component_prop({node: compId, name: "Label",       type: "TEXT",    default: "Label",       bind: labelNodeId})
add_component_prop({node: compId, name: "Placeholder", type: "TEXT",    default: "Placeholder", bind: placeholderNodeId})
add_component_prop({node: compId, name: "Show Icon",   type: "BOOLEAN", default: "true",        bind: iconNodeId})
```

`add_component_prop` calls run in parallel.

**Step 3 — Assemble with instances** (1 jsx call)

```jsx
jsx({markup: `
<frame name="Login Form" w={420} layout="column" gap={24} p={32} bg="#FFFFFF" rounded={16}>
  <frame name="Header" w="fill" layout="column" gap={8}>
    <text size={28} weight="Bold">Sign In</text>
  </frame>
  <frame name="Fields" w="fill" layout="column" gap={16}>
    <instance ref="Text Input"/>
    <instance ref="Text Input"/>
  </frame>
  <instance ref="Button"/>
</frame>
`})
```

**Step 4 — Override instance values** (1 edit call)

Use `edit` with the component property DISPLAY NAMES (the `name` you passed to `add_component_prop`). This handles TEXT, BOOLEAN, and INSTANCE_SWAP props in one batch — and Figma props (w, bg, p) can mix in the same call.

```
edit({nodes: [
  {node: emailInstanceId,  props: {Label: "Email",    Placeholder: "you@example.com"}},
  {node: pwdInstanceId,    props: {Label: "Password", Placeholder: "••••••••"}},
  {node: cardInstanceId,   props: {IconSlot: "1450:59275", Title: "Secure", Description: "..."}},
  {node: buttonInstanceId, props: {"Show Icon": "false", Label: "Sign In"}}
]})
```

### ID tracking across `create_component`

`create_component(oldId)` consumes the original frame and returns a NEW id. The old id becomes invalid; use the returned id for every subsequent operation.

```
Original frame:   "1:37"   (consumed by create_component)
Clone of frame:   "1:62"   (consumed by create_component)
New component:    "1:66"   ← use for create_instance
New instance:     "1:70"   ← use for move_node, edit, etc.
```

### Call count budget

| Step | Tool | Count | Parallel? |
|------|------|-------|-----------|
| 1. Components | jsx | 1 | – |
| 2a. Read IDs | inspect | 1 | – |
| 2b. Add props | add_component_prop | N | Yes |
| 3. Assemble | jsx | 1 | – |
| 4. Overrides | edit | 1 | – |
| Verify | inspect / describe | 1 | – |

Total: ~6–10 calls depending on prop count.

### Replacing an internal frame with an instance (cross-component)

To turn a frame already nested inside a component into a reusable instance (e.g., icon frames inside a Login Form), lift the frame out before converting it:

1. `clone_node({node: "<icon-frame-id>", parent: "/", name: "<Icon Name>"})` → places clone at page level
2. `create_component({node: "<clone-id>"})` → returns new component id
3. `create_instance({node: "<new-component-id>", parent: "<icon-parent-id>"})` → places instance inside the parent component
4. `delete_node({node: "<original-icon-frame-id>"})` → remove the frame it replaces
5. `move_node({node: "<instance-id>", index: 0})` → reorder if needed

Lifting to page level first sidesteps the nested-component rejection — `create_component` on a node already inside another component fails. Each step consumes ~4–5 iterations per icon; budget accordingly.

### Common failure modes

| Error | Cause | Resolution |
|---|---|---|
| "Cannot move node. Reparenting would create a component inside a component" | `create_component` on a node inside another component | Clone to page level, then convert the clone |
| "Node X not found" after `create_component` | Using the old frame ID after conversion | Read `nodeId` from the `create_component` response |
| "X is a FRAME, not a component" on `create_instance` | Target was never converted | Verify `type === "COMPONENT"` via `inspect` |
| "Doing so would create a parenting cycle" on `move_node` | Moving a component into its own instance | Instances are standalone — reorder the instance, not the component |
