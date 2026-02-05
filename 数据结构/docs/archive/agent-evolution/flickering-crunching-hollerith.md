# UI Review: Missing Agent Transparency & Tool Visibility Features

## Executive Summary

After reviewing the current Figma AI Generator UI architecture against the Kilo Code reference capabilities, I've identified significant gaps in **agent execution visibility**, **tool transparency**, and **task orchestration UI**. While the backend has robust agent architecture with full tool execution capabilities, **the UI does NOT expose these capabilities to users**.

---

## Current State Analysis

### What EXISTS (Backend Capabilities)
The backend has a sophisticated agent system that IS NOT visible to users:

1. **AgentRuntime** - Full agentic loop with up to 40 iterations
2. **14 tools** - planDesign, createNode, setNodeLayout, getSelection, etc.
3. **Tool execution with IPC bridge** - Request/response tracking, timeouts
4. **Streaming support** - Real-time node creation, progress callbacks
5. **Context management** - Turn-based truncation, message compression
6. **Session management** - StreamSessionId, RequestId tracking

### What's VISIBLE in UI (Critical Gaps)

| Kilo Code Feature | Current Implementation | Gap Level |
|-------------------|----------------------|-----------|
| **Tool execution steps** | ❌ Not shown | 🔴 Critical |
| **Tool parameters/results** | ❌ Not shown | 🔴 Critical |
| **Agent reasoning (ReAct)** | Partial - only "Thoughts" summary | 🟡 Medium |
| **Real-time execution status** | Only "Generating..." text | 🟡 Medium |
| **Subtask/session management** | ❌ Not shown | 🔴 Critical |
| **Checkpoint/undo system** | ❌ Not visible | 🔴 Critical |
| **Diff viewer for changes** | ❌ Not available | 🔴 Critical |
| **Audit log/history** | ❌ Not available | 🟡 Medium |

---

## Detailed Gap Analysis

### 1. 🔴 Tool Execution Visibility (Critical)

**Kilo Code**: Shows each tool call with:
- Tool name and icon
- Input parameters (collapsible)
- Execution status (Pending → Running → Success/Error)
- Output/result (collapsible)
- Execution timing

**Current State**:
- `onToolCall` and `onToolResult` callbacks exist in `AgentOrchestrator` but are **NOT wired to UI**
- Only `setLoadingStatus(status)` updates a single text field
- No structured display of tool calls

**What needs to change**:
```
Current:    "Generating..." → "Agent complete"
Should be:  [Tool] getSelection → ✓ (32ms)
            [Tool] planDesign → ✓ (245ms)
            [Tool] createNode → ⏳ Running...
            [Tool] setNodeLayout → Pending
```

### 2. 🔴 Agent Reasoning Transparency (Critical)

**Kilo Code**: Interleaves thinking + tool calls in conversation, showing:
- Why the agent chose a particular approach
- What it's planning to do next
- How it's interpreting tool results

**Current State**:
- `ThinkingCard` exists but only shows final summary
- `thinkingText` streams during generation but is ephemeral
- No persistent view of agent's reasoning chain

**What needs to change**:
- Show each iteration's thinking as a collapsible block
- Display plan output from `planDesign` tool
- Link thinking to subsequent tool actions

### 3. 🔴 Subtask/Session Management UI (Critical)

**Kilo Code**: Each conversation is a "Session" with:
- Task metadata (title, status, duration)
- Ability to split into subtasks
- Independent subtask histories
- Result aggregation

**Current State**:
- `history[]` is a flat array of messages
- No session concept in UI (exists in backend as `streamSessionId`)
- No subtask support visible

**What needs to change**:
- Session header showing: task name, iteration count, tools used
- Subtask creation UI (for complex multi-step tasks)
- Session browser/history panel

### 4. 🔴 Checkpoint/Undo System (Critical)

**Kilo Code**: Shadow Git with:
- Automatic checkpoint on each modification
- Diff viewer comparing any two checkpoints
- One-click rollback to any state

**Current State**:
- No checkpoint system in UI
- No visible undo history
- Backend has `RenderLifecycleManager` but no UI exposure

**What needs to change**:
- Checkpoint indicator per tool execution
- Diff viewer for Figma node changes
- Rollback buttons on each checkpoint

### 5. 🟡 Real-time Progress Indicators (Medium)

**Kilo Code**: Detailed execution progress:
- Current iteration number
- Token usage (input/output/total)
- Elapsed time per tool
- Overall progress percentage

**Current State**:
- `ThinkingStream` shows only text
- Token usage tracked but hidden in developer panel
- No timing information

**What needs to change**:
- Progress bar with iteration count: "Iteration 3/40"
- Visible token budget: "12,345 / 200,000 tokens"
- Tool execution timing

### 6. 🟡 Audit Log / Execution History (Medium)

**Kilo Code**: Full audit trail showing:
- All file accesses
- All shell commands run
- All modifications made
- Timestamps and user association

**Current State**:
- `SEND_LOG` events exist but not displayed
- Console logs only (not in UI)
- No persistent history

**What needs to change**:
- Execution log panel (collapsible sidebar)
- Filter by: tool type, status, time range
- Export capability

---

## Proposed UI Changes

### Phase 1: Tool Execution Panel (Highest Priority)

Add a new component: `ToolExecutionPanel`

```
┌─────────────────────────────────────────────┐
│ 🔧 Tool Execution                    [─] [×]│
├─────────────────────────────────────────────┤
│ ✓ getSelection         Selected: Button     │
│   └─ 32ms                                   │
├─────────────────────────────────────────────┤
│ ✓ planDesign           Plan created         │
│   └─ 245ms                                  │
│   └─ [Show Plan] [Show Output]              │
├─────────────────────────────────────────────┤
│ ⏳ createNode          Creating Frame...    │
│   └─ 1.2s elapsed                           │
│   └─ Parameters: { type: 'FRAME', ... }     │
├─────────────────────────────────────────────┤
│ ○ setNodeLayout        Pending              │
│ ○ validateLayout       Pending              │
└─────────────────────────────────────────────┘
```

### Phase 2: Enhanced Thinking Display

Transform `ThinkingCard` to show iteration-by-iteration reasoning:

```
┌─────────────────────────────────────────────┐
│ 💭 Agent Reasoning          Iteration 3/40  │
├─────────────────────────────────────────────┤
│ ▼ Iteration 1                               │
│   "I need to first get the current selection│
│    to understand what I'm working with..."  │
│   → Called: getSelection                    │
├─────────────────────────────────────────────┤
│ ▼ Iteration 2                               │
│   "The user wants a button. I'll create a   │
│    plan for the design structure..."        │
│   → Called: planDesign                      │
├─────────────────────────────────────────────┤
│ ▶ Iteration 3 (current)                     │
│   "Now executing the plan. Creating the     │
│    main frame container first..."           │
│   → Calling: createNode                     │
└─────────────────────────────────────────────┘
```

### Phase 3: Session Management Header

Add session context to chat header:

```
┌─────────────────────────────────────────────┐
│ 📋 Create Login Form          ◉ In Progress │
│ Iteration: 5/40 | Tools: 8 | Tokens: 12,345 │
│ [Pause] [Cancel] [View History]             │
└─────────────────────────────────────────────┘
```

### Phase 4: Checkpoint Sidebar

Add checkpoint history with rollback:

```
┌───────────────────────┐
│ 📍 Checkpoints        │
├───────────────────────┤
│ ● Now                 │
│ ├ createNode Frame    │
│ ├ setNodeLayout       │
│ ○ 2 min ago           │
│ ├ createNode Button   │
│ ○ 5 min ago           │
│   └ [Restore] [Diff]  │
└───────────────────────┘
```

---

## Files to Modify

### New Components to Create:
1. `/src/ui/components/ToolExecutionPanel.tsx` - Tool execution display
2. `/src/ui/components/IterationCard.tsx` - Per-iteration reasoning
3. `/src/ui/components/SessionHeader.tsx` - Session metadata display
4. `/src/ui/components/CheckpointSidebar.tsx` - Checkpoint history
5. `/src/ui/components/ToolCallItem.tsx` - Individual tool call display

### Existing Files to Modify:
1. `/src/features/chat/index.tsx` - Integrate new panels
2. `/src/features/chat/useChat.ts` - Wire up tool callbacks to state
3. `/src/engine/services/AgentOrchestrator.ts` - Enhance callback payloads
4. `/src/types.ts` - Add new state types for tool visibility

### State Changes Needed:
```typescript
// New state in useChat
const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
const [iterations, setIterations] = useState<IterationRecord[]>([]);
const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);

interface ToolCallRecord {
  id: string;
  toolName: string;
  parameters: any;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: any;
  startTime: number;
  endTime?: number;
}

interface IterationRecord {
  number: number;
  thinking: string;
  toolCalls: string[];  // IDs of tool calls in this iteration
}
```

---

## Verification Plan

1. **Tool Visibility Test**: Execute a multi-tool task and verify each tool appears in the panel
2. **Reasoning Transparency Test**: Verify each iteration's thinking is displayed
3. **Session Management Test**: Start multiple sessions and verify proper isolation
4. **Checkpoint Test**: Make modifications and verify rollback works
5. **Performance Test**: Ensure UI updates don't block generation

---

## Implementation Priority

1. **Phase 1** (Critical): Tool Execution Panel - Makes agent transparent
2. **Phase 2** (High): Enhanced Thinking Display - Shows reasoning
3. **Phase 3** (Medium): Session Management - Organizes tasks
4. **Phase 4** (Lower): Checkpoint System - Enables undo

---

## Summary

The current UI treats the agent as a **black box** - users see only a loading indicator and final result. To match Kilo Code's transparency:

1. **Expose tool execution** - Show what tools are being called and their results
2. **Show reasoning chain** - Display each iteration's thinking
3. **Add session management** - Let users see task context and history
4. **Implement checkpoints** - Enable safe exploration with rollback

These changes transform the UI from a simple chat interface into a proper **task orchestrator** where users can observe, understand, and control the agent's actions.

---

## Key Code Evidence

### Problem: Tool Callbacks Exist But Are Not Wired to UI

**In `AgentOrchestrator.ts` (lines 159-165):**
```typescript
private handleToolCall(tc: any) {
  this.options.onStatusChange(`Executing tool: ${tc.name}...`);  // Only sends string!
}

private handleToolResult(tc: any, result: any) {
  console.log(`[Agent] Tool Result (${tc.name}):`, result);  // Console only!
}
```

**In `useChat.ts` (lines 98-120):**
```typescript
const orchestrator = new AgentOrchestrator({
  onStatusChange: (status: string) => setLoadingStatus(status),  // Receives string
  onThinkingUpdate: (thought: string) => { ... },
  onUsageUpdate: (usage: any) => { ... },
  onComplete: (data: any, rawText?: string) => { ... },
  // ❌ NO onToolCall callback!
  // ❌ NO onToolResult callback!
});
```

### What Needs to Change:

1. **Add new callbacks to `OrchestratorOptions`:**
```typescript
interface OrchestratorOptions {
  // ... existing
  onToolCall?: (toolCall: ToolCallRecord) => void;
  onToolResult?: (toolId: string, result: ToolResultRecord) => void;
  onIterationStart?: (iteration: number, thinking: string) => void;
}
```

2. **Add new state to `useChat`:**
```typescript
const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
const [iterations, setIterations] = useState<IterationRecord[]>([]);
```

3. **Wire callbacks in `useChat.ts`:**
```typescript
const orchestrator = new AgentOrchestrator({
  // ... existing
  onToolCall: (tc) => setToolCalls(prev => [...prev, tc]),
  onToolResult: (id, result) => setToolCalls(prev =>
    prev.map(t => t.id === id ? { ...t, result, status: 'success' } : t)
  ),
});
```

4. **Add `ToolExecutionPanel` component to chat UI**
