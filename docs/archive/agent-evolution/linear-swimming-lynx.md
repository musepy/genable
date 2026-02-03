# Plan: Fix Agent Infinite Thinking Loop

## Problem Summary

The agent enters an infinite loop during design generation where it repeatedly thinks about the same steps (e.g., "Step 12", "Steps 13-21") without making progress. The console shows the agent cycling through iterations while the `[Agent] Progress:` messages repeat similar content.

**Evidence from logs:**
- Agent successfully creates initial nodes (128:604, 128:605, etc.)
- Progress messages keep repeating: "I'm now setting the layout in Step 12", "Steps 13-21 for email field group"
- Node 128:610 ("Form Fields Container") remains empty (only `size-px` in Figma output)

## Root Cause Analysis

### 1. `planDesign` Tool Returns No State

**File:** `src/ipc/handlers/toolCallHandler.ts:55-71`

The `planDesign` tool receives a detailed step-by-step plan from the LLM but only acknowledges receipt:
```typescript
response = {
  success: true,
  data: {
    acknowledged: true,
    stepsCount: steps?.length || 0,
    message: 'Plan received. Proceed with execution.'
  }
};
```

The **actual steps array is discarded** and not echoed back. The LLM has no persistent record of which steps have been completed.

### 2. Context Truncation Hides the Plan

**File:** `src/engine/agent/agentRuntime.ts:272-310`

When context exceeds 75% of max tokens (150K of 200K), the `truncateByTurns()` function hides oldest turns:
- The initial `planDesign` call/response gets hidden
- The LLM loses visibility into its own plan
- It regenerates the plan each iteration but can't track which steps were done

### 3. Loop Detection is Too Coarse-Grained

**File:** `src/engine/agent/agentRuntime.ts:482-490`

Current loop detection only catches **identical tool call signatures**:
```typescript
const currentBatchSignature = response.toolCalls.map(tc =>
  `${tc.name}:${JSON.stringify(tc.args)}`).join('|');
```

This misses:
- Repeated `planDesign` calls with different analysis text
- Same tools with slightly different arguments (new nodeIds)
- Semantic loops where the agent re-executes the same logical steps

### 4. No Step Completion Tracking

The system lacks:
- A mechanism to mark plan steps as "completed"
- Correlation between tool calls and plan step numbers
- Step completion status that survives context truncation

## Solution Design

### Approach: Add Step-Level State Tracking

Implement a lightweight step tracking mechanism that persists across iterations and survives context compression.

## Implementation Steps

### Step 1: Enhance `planDesign` Response with Step IDs

**File:** `src/ipc/handlers/toolCallHandler.ts`

Modify the planDesign handler to:
1. Generate unique IDs for each step
2. Store the plan in a runtime state
3. Return step IDs in the response so the LLM can reference them

```typescript
case 'planDesign': {
  const { analysis, steps, contentPlan, layoutStrategy } = parameters;

  // Generate step IDs and store in runtime state
  const stepsWithIds = (steps || []).map((step: any, idx: number) => ({
    ...step,
    stepId: `step_${Date.now()}_${idx}`,
    status: 'pending'
  }));

  // Store plan in a global or context-attached state
  planState.setCurrentPlan(stepsWithIds);

  response = {
    success: true,
    data: {
      acknowledged: true,
      planId: `plan_${Date.now()}`,
      steps: stepsWithIds.map(s => ({ stepId: s.stepId, action: s.action, status: s.status })),
      message: 'Plan received. Execute steps by referencing stepId.'
    }
  };
  break;
}
```

### Step 2: Add Step Completion to Tool Responses

**File:** `src/ipc/handlers/toolCallHandler.ts`

Modify tool handlers to accept an optional `stepId` parameter and mark steps complete:

```typescript
case 'createNode': {
  const { type, name, parentId, characters, stepId } = parameters;
  // ... existing logic ...

  // Mark step as complete if stepId provided
  if (stepId) {
    planState.markStepComplete(stepId);
  }

  response = {
    success: !!node,
    data: {
      nodeId: node?.id,
      name: node?.name,
      stepCompleted: stepId || null
    }
  };
  break;
}
```

### Step 3: Create Plan State Manager

**New File:** `src/engine/agent/planState.ts`

```typescript
interface PlanStep {
  stepId: string;
  action: string;
  parameters?: any;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

class PlanStateManager {
  private currentPlan: PlanStep[] = [];
  private planId: string | null = null;

  setCurrentPlan(steps: PlanStep[]) {
    this.currentPlan = steps;
    this.planId = `plan_${Date.now()}`;
  }

  markStepComplete(stepId: string) {
    const step = this.currentPlan.find(s => s.stepId === stepId);
    if (step) step.status = 'completed';
  }

  getCompletedSteps(): string[] {
    return this.currentPlan.filter(s => s.status === 'completed').map(s => s.stepId);
  }

  getPendingSteps(): PlanStep[] {
    return this.currentPlan.filter(s => s.status === 'pending');
  }

  getSummary(): string {
    const completed = this.currentPlan.filter(s => s.status === 'completed').length;
    const total = this.currentPlan.length;
    return `Progress: ${completed}/${total} steps completed`;
  }

  reset() {
    this.currentPlan = [];
    this.planId = null;
  }
}

export const planState = new PlanStateManager();
```

### Step 4: Inject Step Status into Context

**File:** `src/engine/agent/agentRuntime.ts`

Before each LLM call, inject the current step status as a system reminder:

```typescript
// In run() method, before provider.generate():
const stepSummary = planState.getSummary();
const pendingSteps = planState.getPendingSteps();

if (pendingSteps.length > 0) {
  // Inject step status as a synthetic message (not stored in history)
  const statusReminder = {
    id: 'step_status',
    role: 'system',
    content: `STEP PROGRESS: ${stepSummary}\nPENDING STEPS: ${JSON.stringify(pendingSteps.slice(0, 5))}`
  };
  visibleMessages.push(statusReminder);
}
```

### Step 5: Enhance Loop Detection

**File:** `src/engine/agent/agentRuntime.ts`

Add semantic loop detection for repeated planning:

```typescript
// Track planDesign calls
let planCallCount = 0;
const MAX_PLAN_CALLS = 2;

// In the tool execution section:
if (tc.name === 'planDesign') {
  planCallCount++;
  if (planCallCount > MAX_PLAN_CALLS) {
    throw new Error('Agent stuck in planning loop: too many planDesign calls without progress.');
  }
}

// Reset on meaningful progress (non-plan tools succeed)
if (tc.name !== 'planDesign' && result.success) {
  planCallCount = 0; // Reset when making actual progress
}
```

### Step 6: Update Tool Definitions

**File:** `src/engine/agent/tools/rendererTools.ts`

Add `stepId` as an optional parameter to execution tools:

```typescript
{
  name: 'createNode',
  description: 'Creates a new Figma node...',
  parameters: {
    // ... existing params ...
    stepId: {
      type: 'string',
      description: 'Optional step ID from planDesign to mark as completed upon success'
    }
  }
}
```

## Files to Modify

1. `src/ipc/handlers/toolCallHandler.ts` - Enhance planDesign response, add stepId handling
2. `src/engine/agent/agentRuntime.ts` - Inject step status, enhance loop detection
3. `src/engine/agent/tools/rendererTools.ts` - Add stepId parameter to tool definitions
4. **NEW** `src/engine/agent/planState.ts` - Create plan state manager

## Verification Plan

1. **Unit Tests:**
   - Test `PlanStateManager` state transitions
   - Test step completion marking
   - Test loop detection thresholds

2. **Integration Test:**
   - Generate a multi-step design (e.g., login form)
   - Verify all steps complete without loops
   - Verify context truncation doesn't break progress

3. **Manual Verification:**
   - Run the original failing case (login form generation)
   - Confirm agent progresses through all steps
   - Check console for absence of repeated "Progress:" patterns

## Rollback Plan

If issues arise:
1. Remove `stepId` parameter handling from tool handlers (backwards compatible)
2. Remove step status injection from agentRuntime
3. The `planState` module can remain but be unused
