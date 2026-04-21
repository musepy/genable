---
id: help:sandbox-sop
name: Sandbox Rules (js tool)
description: Use when using the js tool for custom reads, traversals, or API patterns not covered by dedicated tools — covers blocked patterns, the async API rule, and iteration budgeting.
category: help
tags: [js, sandbox, figma-api, async, budget]
---

## Sandbox Rules — `js` tool

The `js` tool runs code inside the Figma plugin main thread. Dedicated tools exist for mutation; `js` is for reads and API patterns no tool covers. The runtime rejects the patterns below — each has a direct tool equivalent.

| Blocked pattern | Reason | Use instead |
|---|---|---|
| `.remove()` | Structural mutations flow through `delete_node` so IDs/bindings stay tracked | `delete_node({node: "1:2"})` |
| `.removeChild()` | Same as above | `delete_node` |
| `.insertChild()` | `move_node` preserves layout order and parent relationship atomically | `move_node({node, parent, index})` |
| `figma.root` / `figma.currentPage.children` | Document-wide traversal bypasses the idMap — results can reference nodes outside this session | `find_nodes({query})` or `inspect({node: "/"})` |
| `eval`, `Function()`, `import()` | Sandbox escape | – |

### What `js` is for

- Reading node properties: `js({code: "const n = await figma.getNodeByIdAsync('1:2'); return {type: n.type, name: n.name}"})`
- Traversing children of a known node: `const comp = await figma.getNodeByIdAsync("1:2"); return comp.children.map(c => ({id: c.id, name: c.name, type: c.type}))`
- Batch reads that would take many `inspect` calls
- Figma API patterns not yet wrapped by a dedicated tool

### Async API rule

The plugin runs in `documentAccess: dynamic-page` mode. Use `figma.getNodeByIdAsync()`; the synchronous `figma.getNodeById()` throws under dynamic-page.

## Iteration Budget

Multi-step workflows (component ↔ instance replacement, large-tree restructures) chain many sequential tool calls.

| Operation | Steps |
|---|---|
| Convert 1 frame to component | 1 |
| Add 1 component property | 1 |
| Replace 1 icon frame → instance | 4–5 (clone + convert + instance + delete + reorder) |
| Replace 5 icons → instances | 20–25 |

When the remaining budget drops below ~10, finish the current logical unit, then report what shipped and what's outstanding — retrying a failed call with identical parameters burns budget without making progress. If the same error surfaces twice, switch tool or stop.
