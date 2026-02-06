# BatchOperations Tool: Project-Aligned Execution Plan

This document is a project-aligned plan for implementing a `batchOperations` tool in the Figma AI generator. It is written as an execution plan for a smaller model to follow without ambiguity.

## Goal
- Reduce tool-call round trips by batching multiple Figma actions into one tool call.
- Preserve correct parent-child dependencies and deterministic ordering.
- Keep tool results compact to avoid context bloat.

## Current Pipeline Constraints (Project-Fact-Based)
- Tool execution happens in the Figma main thread in `src/ipc/handlers/toolCallHandler.ts`.
- `createNode` and `createIcon` use `handleUnifiedRender` (render pipeline).
- Layout and styles are applied via `NodeLayoutService`.
- Figma API is effectively single-threaded for creation and layout operations.
- Runtime uses tool execution strategy grouping, but still receives multiple tool calls if the model emits them.

## Tool Design Summary
- New tool name: `batchOperations`
- Category: "super tool" in `designSuperTools.ts`
- Execution strategy: `sequential` (forced)
- Payload: list of operations with `opId`, `action`, and `params`
- Node reference: `opId`-based mapping (no `$0/$1`)
- Error policy: `skip-dependents` by default

## Tool Schema (JSON Schema)
```
{
  "name": "batchOperations",
  "description": "Execute multiple Figma operations in a single call",
  "parameters": {
    "type": "object",
    "required": ["operations"],
    "properties": {
      "operations": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["opId", "action", "params"],
          "properties": {
            "opId": { "type": "string" },
            "action": {
              "type": "string",
              "enum": [
                "createNode",
                "setNodeLayout",
                "setNodeStyles",
                "updateNodeProperties",
                "createIcon",
                "deleteNode",
                "applyDesignPatch"
              ]
            },
            "params": { "type": "object" },
            "dependsOn": {
              "type": "array",
              "items": { "type": "string" }
            }
          }
        }
      },
      "strategy": {
        "type": "string",
        "enum": ["sequential"],
        "default": "sequential"
      },
      "onError": {
        "type": "string",
        "enum": ["skip-dependents", "continue"],
        "default": "skip-dependents"
      }
    }
  }
}
```

## Example Payload
```
{
  "operations": [
    {
      "opId": "card",
      "action": "createNode",
      "params": { "type": "FRAME", "name": "Card", "parentRef": "root" }
    },
    {
      "opId": "cardLayout",
      "action": "setNodeLayout",
      "params": { "nodeRef": "card", "layoutMode": "VERTICAL", "gap": 12 }
    },
    {
      "opId": "title",
      "action": "createNode",
      "params": { "type": "TEXT", "name": "Title", "characters": "Hello", "parentRef": "card" }
    }
  ],
  "strategy": "sequential",
  "onError": "skip-dependents"
}
```

## Supported Actions (Match Existing Tools)
- `createNode`
- `setNodeLayout`
- `setNodeStyles`
- `updateNodeProperties`
- `createIcon`
- `deleteNode`
- `applyDesignPatch` (optional but useful)

## Execution Rules
1. Execute operations strictly in order.
2. Resolve `nodeRef` and `parentRef` to real `nodeId` using `opId` mapping.
3. If a referenced `opId` failed or is missing and `onError=skip-dependents`, mark this operation as `skipped`.
4. If a referenced `opId` failed or is missing and `onError=continue`, this operation should fail with `MISSING_REF`.
5. All creation and modification operations must reuse existing implementations in the IPC handler.

## Operation Mapping (Implementation)
- `createNode`: `handleUnifiedRender`
- `createIcon`: `handleUnifiedRender`
- `setNodeLayout`: `nodeLayoutService.applyLayout`
- `setNodeStyles`: `nodeLayoutService.applyStyles`
- `updateNodeProperties`: `NodeSerializer` + `handleUnifiedRender`
- `deleteNode`: `nodeLayoutService.deleteNode`
- `applyDesignPatch`: existing batch modifier

## Return Format (Compact)
```
{
  "success": true,
  "data": {
    "results": [
      { "opId": "card", "action": "createNode", "success": true, "nodeId": "123:1" },
      { "opId": "cardLayout", "action": "setNodeLayout", "success": true },
      { "opId": "title", "action": "createNode", "success": true, "nodeId": "123:2" }
    ],
    "idMap": { "card": "123:1", "title": "123:2" }
  }
}
```

## Error Codes (Recommended)
- `INVALID_ACTION`
- `MISSING_REF`
- `DEPENDENCY_SKIP`
- `NODE_NOT_FOUND`
- `APPLY_ERROR`

## Integration Steps (File-Level Checklist)
1. Add tool definition: `src/engine/agent/tools/designSuperTools.ts`
2. Register tool: `src/engine/agent/tools/index.ts` (agentTools + EXECUTION_TOOLS)
3. Implement tool handler: `src/ipc/handlers/toolCallHandler.ts` (add `case 'batchOperations'`)
4. Prompt rule: `src/engine/agent/agentPrompts.ts` (require batch for 2+ ops)
5. Loop-signature fingerprint: `src/engine/agent/agentRuntime.ts` (suggest `|batch:${ops.length}|ops:${hash(opIds.join(','))}`)
6. Optional UI support: `src/ui/components/ToolExecutionPanel.tsx` (extract multiple nodeIds from `data.results`)

## Prompt Guidance (Strict Rules)
1. If 2+ Figma operations are needed, you MUST use `batchOperations`.
2. NEVER emit multiple individual tool calls for node creation.
3. `opId` must be unique within a batch. Use semantic names like "header" or "button".
4. `parentRef` must reference an earlier `opId` or be "root".
5. Do NOT narrate. Output ONLY the tool call.

## Prompt Guidance (Short Version)
- Use `batchOperations` for 2+ ops.
- Only reference nodes by `opId`.
- Parent before child.

## When to Use applyDesignPatch
- If you only need to modify existing nodes and do not create any new nodes, prefer `applyDesignPatch`.
- If you have a mix of creation and edits, use `batchOperations` and include the edits as actions in the same batch.

## Expected Token Savings (Rough)
| Scenario | Traditional | BatchOp | Savings |
|:---|:---|:---|:---|
| Create 5-node card | ~2500 tokens (5 calls + 5 results) | ~800 tokens (1 call + 1 result) | ~68% |

## Acceptance Criteria
- Single tool call for a multi-node UI task.
- Stable parent-child creation order without missing IDs.
- Results contain `idMap` for follow-up operations.
- No repeated progress narration in output.

## Notes
- Do not introduce a new `appendChild` tool. Use `parentRef` in `createNode`.
- Avoid parallel execution; Figma main thread is sequential.
