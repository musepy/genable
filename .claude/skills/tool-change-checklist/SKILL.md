---
name: tool-change-checklist
description: Checklist for adding, modifying, or removing LLM-facing tools — ensures all coupled files are updated together
trigger: (新增工具|改工具|删工具|add tool|remove tool|rename tool|tool api|工具改动|tool change|tool refactor)
---

# Tool Change Checklist

When adding, modifying, or removing an LLM-facing tool, multiple files must be updated in sync. Missing any one causes subtle bugs (LLM sees stale examples, handler not registered, old addressing format leaks through).

## File Chain (all must be consistent)

### 1. Tool Definition
`src/engine/agent/tools/unified/<toolName>.ts`
- `name`, `description`, `parameters`, `executionStrategy`, `mutates?`
- **Examples in description must use current addressing format** (bare Figma ID like `"1:2"`, NOT `name#id`)
- Parameter descriptions must not expose internal formats (e.g., Figma's `Name#1386:100` property keys)

### 2. Tool Registration
`src/engine/agent/tools/unified/index.ts`
- Import + add to `unifiedTools` array
- Position in array = order LLM sees them

### 3. IPC Handler
`src/ipc/commands/<toolName>Handler.ts` (or existing handler)
- Actual implementation running on Figma main thread
- Use `async` APIs (`getNodeByIdAsync`, `getMainComponentAsync`) — sync versions are forbidden in `dynamic-page` mode

### 4. Adapter (if handler is shared)
`src/ipc/commands/<tool>Adapter.ts`
- Maps structured params from tool definition to handler's internal format
- Thin layer — just param mapping, no logic

### 5. Dispatch Table
`src/ipc/commands/index.ts`
- Import handler + add entry to `COMMAND_HANDLERS` record
- Key must exactly match tool definition's `name`

### 6. System Prompt
`src/engine/llm-client/context/system.ts`
- Memory/scratchpad/selection docs must use current tool names
- Tool call examples (not CLI paths like `mk /.agent/memory/key`)
- If a tool replaces an old mechanism, update the system prompt section entirely

### 7. Internal Runtime Callers
`src/engine/agent/agentRuntime.ts` + `src/engine/services/AgentOrchestrator.ts`
- Grep for `callTool('oldName')` — runtime code that calls tools internally (not via LLM)
- These break silently: old name still in dispatch table as legacy compat, but semantics may diverge
- Also check: does the orchestrator auto-inject context that should now be a tool? (e.g., selection was auto-injected, now it's `get_selection`)

### 8. Prompt Files
`src/prompts/CORE.md`, `src/prompts/WORKFLOW.md`
- Tool documentation in CREATION PROTOCOL section
- Examples must match current tool API
- Rebuild catalog: changes auto-flow to `src/generated/prompt-catalog.json`

## Sandbox-Local Interactive Tools (e.g., `ask_user`)

Some tools run entirely in the sandbox (no IPC to main thread). They pause execution, emit a runtime event, wait for user input via Promise, then return the result as tool output. **Different file chain** from IPC tools:

### File Chain

| Step | File | What |
|------|------|------|
| 1. Tool definition | `src/engine/agent/tools/unified/<tool>.ts` | Same as IPC tools |
| 2. Registration | `src/engine/agent/tools/unified/index.ts` | Same — add to `unifiedTools` |
| 3. Runtime event | `src/shared/protocol/agentRuntimeEvents.ts` | New event interface + add to union + add to EventType |
| 4. Local executor | `src/engine/agent/agentRuntime.ts` | Register via `mergeExecutors()` — emit event → `await new Promise` → return result |
| 5. Promise + cancel | `src/engine/agent/agentRuntime.ts` | `private pendingX` field + `public resolveX()` + cleanup in `cancel()` |
| 6. Timeout exemption | `src/engine/agent/toolDispatcher.ts` | `executeToolWithTimeout()` — skip timeout for user-interactive tools |
| 7. Orchestrator bridge | `src/engine/services/AgentOrchestrator.ts` | Public method that calls `this.activeAgent?.resolveX()` |
| 8. UI state | `src/features/chat/useChat.ts` | State + event handler + response function + export + clear on cancel/restore/turn_end |
| 9. UI rendering | `src/features/chat/index.tsx` | Panel rendering + destructure from useChat |
| 10. Prompt guidance | `src/prompts/CORE.md` | When/how to use the tool |
| 11. Dev bridge (E2E) | `tools/dev-bridge/server.ts` + `src/dev/useDevBridge.ts` | Server: GET/POST `/answer/:id`. Plugin: detect event → stream to bridge → poll for answer → respond |

### Key Pattern: Promise-based pause/resume (mirrors `pendingApproval`)
```typescript
// agentRuntime.ts
private pendingX: { resolve: (val: T) => void } | null = null;
public resolveX(val: T): void { this.pendingX?.resolve(val); this.pendingX = null; }
// cancel():
if (this.pendingX) { this.pendingX.resolve(defaultVal); this.pendingX = null; }
```

### Nudge mechanism (when LLM ignores the tool)
If the LLM responds with plain text instead of calling the interactive tool, inject a synthetic user message telling it to use the tool. Track `nudged` flag to fire only once per run. Located in agentRuntime.ts text-only response handling section.

## Common Mistakes (from real incidents)

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Old `name#id` in tool description examples | LLM generates `"Card#1:2"` instead of `"1:2"` | Grep all tool defs for `#\d+:` |
| Deleted tool still called from runtime | `Unknown tool "render"` errors in E2E | Grep codebase for old tool name |
| Handler uses sync Figma API | `Cannot call with documentAccess: dynamic-page` | Use `*Async` versions |
| Internal key format exposed to LLM | LLM uses `Name#1386:100` instead of display name `Name` | Hide internal keys in handler output |
| Tool registered in definition but not dispatch table | Tool call silently fails with "Unknown tool" | Check both `unified/index.ts` AND `commands/index.ts` |
| Prompt not updated after tool change | LLM doesn't know new tool exists or uses old API | Update CORE.md + rebuild catalog |
| System prompt uses old CLI tool names | LLM told to use `mk /.agent/memory/key` but `mk` not in tool list | Update system.ts docs to use new tool call format |
| Runtime `callTool('oldName')` not migrated | Silent: old name in legacy dispatch table, but misses new adapter logic | Grep agentRuntime + orchestrator for `callTool(` |
| Orchestrator auto-injects what should be a tool | LLM context polluted, wrong intent inferred | Move injection to opt-in tool (e.g., selection → `get_selection`) |

## Verification

After any tool change:
1. `npx tsc --noEmit` — type check
2. `node build.js` — build
3. `grep -r "oldToolName\|old#format"` across tool defs, handlers, prompts, **system.ts**, **agentRuntime.ts**
4. Check `COMMAND_HANDLERS` in `ipc/commands/index.ts` — key matches `ToolDefinition.name`?
5. Check `system.ts` — old CLI-style docs replaced with tool call examples?
6. Check `agentRuntime.ts` — any `callTool('oldName')` still present?
7. E2E via dev bridge: `curl -X POST localhost:3456/trigger` + SSE stream
