# Plan: State-Driven Tool Refactor (renderElement + patchElement)

## Context

**Problem**: The LLM uses atomic tools (`createNode` → `setNodeLayout` → `setNodeStyles`) in loops, causing O(n²) token consumption. A login form takes 26+ iterations. Despite `generateDesign` existing as a one-shot tool, the LLM still falls back to atomic tools for incremental work.

**Goal**: Replace 5 atomic tools with 2 state-driven high-level tools:
- `renderElement(parentId, element)` — create a complete element with full DSL in one call
- `patchElement(nodeId, fragment)` — modify an element by merging a DSL fragment with current state

**Key Insight**: The infrastructure already exists. `handleUnifiedRender` accepts full `NodeLayer` trees. `NodeSerializer.serialize()` can read current state. `updateNodeProperties` already uses the serialize→merge→re-render pattern. We're essentially promoting existing internal patterns to first-class LLM tools.

---

## Phase 1: Add New Tool Definitions

### File: `src/engine/agent/tools/stateTools.ts` (NEW)

Create two tool definitions:

**`renderElement`**:
- Params: `{ parentId?: string, element: { type, props, children? }, stepId? }`
- `element` matches `NodeLayer` schema (type + props + recursive children)
- `props.name` required; all layout/visual/text/icon props go in `props`
- Description emphasizes: "Use this instead of createNode + setNodeLayout + setNodeStyles chains"

**`patchElement`**:
- Params: `{ nodeId: string, fragment: { ...anyProps }, stepId? }`
- `fragment` is a partial props object — only specify what changes
- Description: "Reads current state, merges your fragment, re-renders. Children preserved automatically."

### File: `src/engine/agent/tools/index.ts`

- Import `renderElementDefinition`, `patchElementDefinition` from `./stateTools`
- Add both to `agentTools` array (after `generateDesignDefinition`)
- Add `'renderElement'` and `'patchElement'` to `EXECUTION_TOOLS`

---

## Phase 2: Add Handlers in toolCallHandler.ts

### `renderElement` handler (~30 lines)

```
case 'renderElement':
  1. Validate: element.type exists, element.props.name exists → error INVALID_DSL if not
  2. Resolve parent: nodeLayoutService.resolveParent(parentId)
  3. Render: handleUnifiedRender({ type, props, children, designSystemId, streamSessionId, meta })
  4. Visibility validation: validateVisibility(node) + auto-fix errors
  5. Return: { nodeId, name, type, childrenCount }
```

Reuses: `handleUnifiedRender`, `resolveParent`, `validateVisibility` — all existing.

### `patchElement` handler (~35 lines)

```
case 'patchElement':
  1. Validate: nodeId + non-empty fragment
  2. Fetch node: figma.getNodeByIdAsync(nodeId)
  3. Serialize: NodeSerializer.serialize(node) → currentDSL
  4. Merge: { ...currentDSL.props, ...fragment } (shallow)
  5. Re-render: handleUnifiedRender({ type, mergedProps, children: currentDSL.children, __modifyMode: 'UPDATE', __modifyTargetId: nodeId })
  6. Return: { nodeId (original), modified: true, propsUpdated: Object.keys(fragment) }
```

This is essentially the same pattern as the existing `updateNodeProperties` handler (lines 227-272), but unified — no separate layout/styles/properties distinction.

---

## Phase 3: Update batchOperations

### File: `src/ipc/handlers/toolCallHandler.ts` (batchOperations case, line 415-460)

Update `allowedActions` Set to include `'renderElement'` and `'patchElement'`.

### File: `src/ipc/handlers/batchExecutor.ts` or inline in `executeBatchAction`

Add two new cases to `executeBatchAction`:
- `'renderElement'`: resolve parent via `batchResolveParentId`, render, register in idMap
- `'patchElement'`: resolve nodeId via `batchResolveNodeId`, serialize→merge→render

---

## Phase 4: Update Skill Docs (Prompt Engineering)

### File: `.agent/skills/figma-core/SKILL.md`

Add section documenting `renderElement` and `patchElement` with examples. Mark atomic tools as legacy. This is critical — the LLM needs to see examples to prefer the new tools.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/engine/agent/tools/stateTools.ts` | **NEW** — renderElement + patchElement definitions |
| `src/engine/agent/tools/index.ts` | Import + register new tools, update EXECUTION_TOOLS |
| `src/ipc/handlers/toolCallHandler.ts` | Add 2 new handler cases, update batchOperations allowedActions |
| `.agent/skills/figma-core/SKILL.md` | Add examples for new tools, mark legacy |

## Existing Infrastructure Reused (no changes needed)

- `handleUnifiedRender()` — `src/ipc/helpers/renderHelper.ts`
- `NodeSerializer.serialize()` — `src/engine/figma-adapter/nodeSerializer.ts`
- `nodeLayoutService.resolveParent()` — existing service
- `validateVisibility()` — `src/engine/validation/visibilityValidator.ts`
- `RenderOrchestrator` + `Normalizer` — existing pipeline
- `BatchExecutor` + `batchResolveNodeId`/`batchResolveParentId` — `src/ipc/handlers/batchExecutor.ts`

---

## Verification

1. **Unit tests**: Add `src/ipc/handlers/__tests__/stateTools.test.ts`
   - renderElement: creates frame with props, creates nested children, rejects missing name
   - patchElement: merges fragment, preserves unchanged props, preserves children
   - batchOperations: renderElement + patchElement in batch with virtual ID refs

2. **Build**: `npm run build` should pass

3. **Manual test**: Run plugin, send prompt that would normally use 10+ atomic tool calls. Verify the LLM uses `renderElement` instead (requires skill doc updates to take effect).

---

## Migration Strategy

**Non-breaking**: Old tools remain. New tools added alongside. No removal phase in this PR. Future deprecation after confirming LLM adoption.
