# Component System Test Report -- 2026-03-09

## Summary

| Test | Description | Components Used? | Instances? | Overrides? | Result |
|------|-------------|-----------------|------------|------------|--------|
| 1a | Explicit component (stat cards) | Y (reusable='true') | N (ref failed) | N/A | FAIL |
| 1b | Implicit component (dashboard stats) | Y (reusable='true') | N (ref failed) | N/A | FAIL |
| 2  | Instance overrides (notifications) | Y (reusable='true') | N (ref failed) | N/A | FAIL |
| 3  | Multi-turn pricing cards | N (no reusable) | N (ref failed) | N/A | PARTIAL |
| 4  | Complex hierarchy (team grid) | Y (reusable='true') | N (ref failed) | N/A | FAIL |
| 5  | Single login (no components) | N (correct) | N (correct) | N/A | PASS |

**Overall: 1 PASS, 1 PARTIAL, 4 FAIL. Root cause: cross-batch symbol resolution is broken.**

## Critical Bug: `tempIdMap` is Batch-Scoped

Every test that attempted `<ref component='X'>` failed with **"Component source not found"**. The root cause:

1. LLM creates the component in tool call #1: `<frame name='StatCard' reusable='true' ...>` -- this succeeds and creates a COMPONENT node (confirmed in tree.json).
2. LLM instantiates in tool call #2: `<ref component='StatCard' ...>` -- this fails because `resolveComponent()` cannot find the component.

**Why**: `ActionExecutor.execute()` calls `this.tempIdMap.clear()` at line 29 of `executor.ts` at the start of each batch. The component symbol `statCard` was mapped to a real Figma node ID (e.g., `846:4211`) during call #1, but that mapping is erased before call #2 begins.

The `resolveComponent()` method (line 601-617) tries:
1. `figma.importComponentByKeyAsync(key)` -- `key` is undefined (no componentKey in the action)
2. `figma.getNodeByIdAsync(resolveId(nodeId))` -- `resolveId('statCard')` returns `'statCard'` (not in tempIdMap), so `getNodeByIdAsync('statCard')` returns null

**Fix needed**: Component references need a persistent registry that survives across `execute()` calls. Options:
- A `componentMap: Map<string, string>` (symbol -> real Figma node ID) that persists across batches
- Or: the compiler should emit the real Figma node ID (from the previous batch's idMap response) instead of the symbol name

## Detailed Results

### Test 1a: Explicit Component Prompt

- **Trigger ID**: trigger-1773045792189
- **Duration**: 214913ms (~3.6 min)
- **Model**: kimi-k2.5
- **Tool Calls**: 13 total, 5 errors
- **Component XML** (call 1, SUCCESS):
  ```xml
  <frame name='StatCard' reusable='true' layout='row' gap='16' p='20' bg='#FFFFFF' corner='12'
         shadow='0,2,8,0,#0000001A' w='240' height='hug'>
    <frame name='IconContainer' ...><icon name='Icon' icon='lucide:bar-chart-2' .../></frame>
    <frame name='Content' layout='column' gap='4' width='fill' height='hug'>
      <text name='label' size='14' fill='#64748B'>Label</text>
      <text name='value' size='24' weight='Bold' fill='#0F172A'>Value</text>
    </frame>
  </frame>
  ```
- **Instance XML** (calls 2-3, 6-7, 8 -- ALL FAILED):
  ```xml
  <ref component='StatCard' w='fill' set:label='Revenue' set:value='$48K'/>
  <ref component='StatCard' w='fill' set:label='Users' set:value='2.4K'/>
  <ref component='StatCard' w='fill' set:label='Growth' set:value='+12%'/>
  ```
  Error: "Component source not found" (all attempts)
- **Fallback**: Agent created 3 separate regular frames with duplicated XML (call 11, 18 nodes)
- **Tree**: 2x COMPONENT nodes created (agent tried twice), 0 INSTANCE nodes
- **Assessment**: Component creation works. Instance creation completely broken. LLM correctly used `reusable='true'` and `<ref>` syntax with `set:` overrides. The agent recovered gracefully by falling back to manual frame creation, but this defeats the purpose of the component system.

### Test 1b: Implicit Component Opportunity

- **Trigger ID**: trigger-1773046096403
- **Duration**: 116167ms (~1.9 min)
- **Model**: kimi-k2.5
- **Tool Calls**: 7 total, 1 error
- **Component XML** (call 3, SUCCESS): Created `StatCard` as `reusable='true'` inside a Metrics Row
- **Instance XML** (call 4, FAILED):
  ```xml
  <ref component='StatCard' w='fill' set:label='Total Revenue' set:value='$48,250' .../>
  <ref component='StatCard' w='fill' set:label='Active Users' set:value='2,420' .../>
  ```
  Error: "Component source not found" (4 refs failed)
- **Fallback**: Agent created 4 regular frames with full XML duplication (36 nodes)
- **Tree**: 1x COMPONENT node, 0 INSTANCE nodes
- **Assessment**: LLM correctly identified the implicit component opportunity even without the word "reusable" in the prompt. Good prompt adoption. Same resolution failure.

### Test 2: Component Instance Overrides

- **Trigger ID**: trigger-1773046371544
- **Duration**: 86589ms (~1.4 min)
- **Model**: kimi-k2.5
- **Tool Calls**: 6 total, 2 errors
- **Component XML** (call 1, SUCCESS):
  ```xml
  <frame name='NotificationCard' reusable='true' layout='row' gap='12' p='16' w='400' height='hug'
         bg='#FFFFFF' corner='12' shadow='0,2,8,0,#0000001A'>
    <frame name='IconContainer' ...><icon name='StatusIcon' .../></frame>
    <frame name='Content' layout='column' gap='4' width='fill' height='hug'>
      <text name='Title' size='16' weight='Bold' fill='#111827'>Notification Title</text>
      <text name='Message' size='14' fill='#6B7280'>Notification message goes here</text>
      <text name='Timestamp' size='12' fill='#9CA3AF'>Just now</text>
    </frame>
  </frame>
  ```
- **Instance XML** (calls 2 and 4, BOTH FAILED):
  ```xml
  <ref component='NotificationCard' set:title='Success!' set:message='Your changes...'
       set:timestamp='2 min ago' set:IconContainer-bg='#D1FAE5' .../>
  ```
  Error: "Component source not found" (6 refs failed across 2 attempts)
- **Fallback**: Agent created 3 separate frames with full styling (22 nodes) -- success/warning/error with correct differentiated colors
- **Override syntax observed**: LLM used both `set:childName` (text overrides) and attempted `set:childName-prop` syntax (style overrides like `set:IconContainer-bg`). The latter would need special handling even if instances were created.
- **Tree**: 1x COMPONENT node, 0 INSTANCE nodes
- **Assessment**: Override syntax is correct for text. Cannot verify override application since instances never created.

### Test 3: Multi-Turn Pricing Cards

- **Turn 1 Trigger ID**: trigger-1773046492146
- **Turn 1 Duration**: 114841ms (~1.9 min)
- **Turn 1 Tool Calls**: 8 total, 0 errors
- **Turn 1 Analysis**: LLM created a pricing card as a regular FRAME (NOT a component). Despite the prompt saying "pricing card component", `reusable='true'` was NOT used. The LLM made a design judgment that a single card doesn't need to be a component.

- **Turn 2 Trigger ID**: trigger-1773046642415
- **Turn 2 Duration**: 153539ms (~2.6 min)
- **Turn 2 Tool Calls**: 17 total, 2 errors
- **Turn 2 Analysis**: LLM tried `<ref component='PricingCard'>` twice (calls 9, 12) -- both failed with "Component source not found". This time the component wasn't even created as reusable in Turn 1, so the reference was doubly invalid. Agent fell back to creating 3 separate frame-based cards.

- **Turn 3 Trigger ID**: trigger-1773046824941
- **Turn 3 Duration**: 45303ms (~0.8 min)
- **Turn 3 Tool Calls**: 21 total, 2 errors (same errors from Turn 2 history)
- **Turn 3 Analysis**: The edit operation succeeded. The agent used `read` to find the Pro card's CTA button node ID, then used `edit` to change text: `<text id="847:4497">Most Popular</text>`. Edit on regular frames works correctly.
- **Assessment**: PARTIAL -- edit flow works, but components/instances never used. The LLM's decision not to use `reusable='true'` in Turn 1 is debatable but reasonable for a single-card-first workflow.

### Test 4: Complex Component Hierarchy (Team Grid)

- **Trigger ID**: trigger-1773046909858
- **Duration**: 67937ms (~1.1 min)
- **Model**: kimi-k2.5
- **Tool Calls**: 4 total, 1 error
- **Component XML** (call 3, SUCCESS):
  ```xml
  <frame name='TeamMemberCard' reusable='true' layout='column' gap='16' p='24' w='280'
         height='hug' bg='#FFFFFF' corner='12' shadow='0,1,3,0,...' alignItems='center'>
    <ellipse name='Avatar' w='80' h='80' fill='#E2E8F0'/>
    <frame name='Info' layout='column' gap='4' ...>
      <text name='Name' ...>Team Member</text>
      <text name='Role' ...>Role Title</text>
    </frame>
    <frame name='Social Links' ...>...</frame>
  </frame>
  ```
- **Instance XML** (call 4, FAILED -- 6 refs):
  ```xml
  <ref component='TeamMemberCard' set:name='Sarah Chen' set:role='CEO & Co-Founder' .../>
  <!-- ...5 more refs -->
  ```
  Error: "Component source not found" (6 refs failed)
- **Agent stopped**: Only 4 tool calls, agent's final text was mid-thought ("Let me create the team grid with the correct component reference"). The agent appeared to run out of iterations or the turn ended prematurely.
- **Tree**: 1x COMPONENT node (TeamMemberCard), 0 INSTANCE nodes
- **Assessment**: FAIL. The agent correctly identified the 1-component + 6-instances pattern but couldn't execute it. The incomplete fallback is concerning -- in other tests the agent recovered, but here it didn't.

### Test 5: Single Login Form (No Components)

- **Trigger ID**: trigger-1773047028164
- **Duration**: 42993ms (~0.7 min)
- **Model**: kimi-k2.5
- **Tool Calls**: 3 total, 0 errors
- **Analysis**: No `reusable='true'` used. No `<ref>` tags. Single `create` call produced a clean login page (FRAME type). 2 query calls + 1 create.
- **Tree**: Regular FRAME "Login Page" -- correct behavior
- **Assessment**: PASS. Agent correctly identified this as a one-off design with no repeated elements and did not attempt to use the component system.

## Key Findings

### 1. LLM Prompt Adoption: GOOD
The LLM (kimi-k2.5) correctly uses the component-first workflow:
- Uses `reusable='true'` when creating component definitions (Tests 1a, 1b, 2, 4)
- Uses `<ref component='X'>` with `set:` overrides for instances
- Correctly identifies implicit component opportunities (Test 1b -- "4 identical stat cards")
- Correctly avoids components for one-off designs (Test 5)
- Uses proper text override syntax: `set:label='Revenue'`, `set:value='$48K'`
- Even attempted style overrides: `set:IconContainer-bg='#D1FAE5'` (Test 2)

### 2. resolveComponent() Fails Due to Batch-Scoped tempIdMap: CRITICAL BUG
The `tempIdMap` fix mentioned in the task context (resolving symbols via tempIdMap) only works WITHIN a single `execute()` batch. Since the LLM makes the component in one tool call and instances in the next, the map is always empty when instances are attempted.

The execution flow:
```
Tool call 1: create(<frame name='StatCard' reusable='true'...>)
  -> executor.execute() -> tempIdMap: {statCard: "846:4211"} -> SUCCESS
  -> tempIdMap.clear() at end

Tool call 2: create(<ref component='StatCard'...>)
  -> executor.execute() -> tempIdMap is EMPTY
  -> resolveComponent(undefined, "statCard")
  -> resolveId("statCard") returns "statCard" (not in map)
  -> figma.getNodeByIdAsync("statCard") -> null
  -> "Component source not found"
```

### 3. Graceful Fallback: GOOD (mostly)
In 4/5 failing tests, the agent recovered by creating individual frames with duplicated XML. This is wasteful (e.g., 36 nodes instead of 1 component + 4 instances in Test 1b) but produces a working visual result. Test 4 was the exception where the agent didn't complete the fallback.

### 4. Edit on Regular Frames: WORKS
Test 3 Turn 3 confirmed that editing regular frame nodes (finding by ID, changing text) works correctly even without the component/instance system.

## Component System Verdict

- [x] XML Parsing: Works -- `reusable='true'` correctly parsed, `<ref component='X' set:...>` correctly parsed
- [x] Compilation: Works -- ParsedLine with `reusable: true` and `command: 'instance'` correctly generated
- [ ] Symbol Resolution (the fix): **BROKEN** -- tempIdMap is batch-scoped, cross-batch component refs fail
- [ ] Instance Overrides: **UNTESTABLE** -- instances never created, so overrides cannot be verified
- [x] LLM Adoption: Good -- prompts correctly guide the LLM to use component-first workflow

## Recommended Fixes

### P0: Persistent Component Registry
Add a `componentRegistry: Map<string, string>` to `ActionExecutor` that:
- Persists across `execute()` calls (NOT cleared in `execute()`)
- Is populated when a `create` action has `reusable: true` and succeeds
- Is consulted by `resolveComponent()` before falling back to `figma.getNodeByIdAsync()`
- Is optionally cleared on session reset ("New Design")

Alternatively, the IPC layer that dispatches tool calls could maintain the component symbol-to-ID map and inject real Figma IDs into subsequent `<ref>` XML before passing to the parser.

### P1: Same-Batch Ref Support
Allow `<ref>` tags in the same XML as the component definition. Currently the dependency system should handle this (via `dependsOn`), but it may need testing to confirm topological sort puts the component before its instances within a single batch.

### P2: Style Override Syntax
The LLM attempted `set:IconContainer-bg='#D1FAE5'` (Test 2) to override child frame backgrounds. The current parser only handles `set:childName` -> `{characters: value}` (text overrides). Consider supporting `set:childName.prop` or `set:childName-prop` for style overrides on instances.
