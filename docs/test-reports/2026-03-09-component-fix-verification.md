# Component Fix Verification — 2026-03-09

## Verdict: FIX PARTIALLY WORKS

The `componentRegistry` cross-batch fix is correctly implemented in the executor code. However, the LLM (kimi-k2.5) does not reliably use `<ref component='...'>` in **separate** tool calls. It either duplicates the full component XML (Tests 1 & 2) or uses `<ref>` within the **same** tool call (Test 3). The same-batch path (Test 3) works perfectly — 3 real INSTANCE nodes with correct overrides. The cross-batch path was never exercised because the LLM never generated the cross-batch pattern.

**Bottom line**: The runtime fix is correct, but the LLM behavior prevents us from confirming the cross-batch resolution path in production. The fix is a necessary safety net, but the LLM needs prompt/example guidance to actually use `<ref>` in separate tool calls.

## Results

### Test 1: Basic Component + Instance

- **Trigger ID**: `trigger-1773047531885`
- **Duration**: 37,907 ms
- **Model**: kimi-k2.5
- **Tool calls**: 2 (both `create`, both `status: success`, 0 errors)
- **COMPONENT nodes**: 2
- **INSTANCE nodes**: 0
- **FRAME nodes**: 0
- **TEXT nodes**: 4
- **Ref resolution**: NOT TESTED — LLM never used `<ref>` syntax
- **Screenshot**: `/tmp/figma-bridge/results/trigger-1773047531885/screenshot.png` (512x230)

**Analysis**: The LLM created the component twice with `reusable='true'` as two identical `create` calls with identical XML. It did not use `<ref component='StatCard'>` in the second call. Both calls produced COMPONENT nodes, not instances. No text overrides (Revenue, Users, Growth) were applied — both cards show the default "Label" and "0" text. The LLM described 3 instances in its final text but only produced 2 duplicate components.

**Tool call #1 XML**: `<frame name='StatCard' reusable='true' ...><text name='label' ...>Label</text><text name='value' ...>0</text></frame>`
**Tool call #2 XML**: Identical to #1 (verbatim copy)

### Test 2: Component with Text Overrides

- **Trigger ID**: `trigger-1773047689868`
- **Duration**: 75,854 ms
- **Model**: kimi-k2.5
- **Tool calls**: 8 (3 `query` + 5 `create`, all `status: success`, 0 errors)
- **COMPONENT nodes**: 5
- **INSTANCE nodes**: 0
- **FRAME nodes**: 10 (inner content frames)
- **TEXT nodes**: 15
- **GROUP nodes**: 5 (icon groups)
- **VECTOR nodes**: 10 (icon vectors)
- **Ref resolution**: NOT TESTED — LLM never used `<ref>` syntax
- **Screenshot**: `/tmp/figma-bridge/results/trigger-1773047689868/screenshot.png` (832x210)

**Analysis**: The LLM created 5 separate COMPONENT nodes (all named "NotificationCard"), each with `reusable='true'`. It never used `<ref>` to instantiate from a component definition. Each card was built from scratch with slightly varying XML. The LLM hallucinated success in its final text but actually produced duplicated components, not instances.

### Test 3: Same-batch Component + Instance

- **Trigger ID**: `trigger-1773047796119`
- **Duration**: 22,961 ms
- **Model**: kimi-k2.5
- **Tool calls**: 1 (single `create`, `status: success`, 0 errors)
- **COMPONENT nodes**: 1 (Button)
- **INSTANCE nodes**: 3 (Primary, Secondary, Danger)
- **FRAME nodes**: 1 (Button Row container)
- **TEXT nodes**: 4 (1 in component + 3 overridden in instances)
- **Ref resolution**: SUCCESS (within same batch via `tempIdMap`)
- **Screenshot**: `/tmp/figma-bridge/results/trigger-1773047796119/screenshot.png` (720x184)

**Analysis**: The LLM successfully used `<ref component='Button'>` syntax within a single XML payload. The parser generated proper `createComponent` + `createInstance` actions, and the executor resolved the component via `tempIdMap` (same batch). All 3 instances have correct text overrides and background colors:

| Instance | Label | Fill Color |
|----------|-------|-----------|
| ref1 (849:4631) | Primary | #3B82F6 (blue) |
| ref2 (849:4633) | Secondary | #6B7280 (gray) |
| ref3 (849:4635) | Danger | #EF4444 (red) |

**Tool call XML**:
```xml
<frame name='Button' reusable='true' layout='row' gap='8' p='12 20' w='hug' h='44' corner='8' bg='#3B82F6' justifyContent='center' alignItems='center'>
  <text name='label' size='16' weight='Medium' fill='#FFFFFF'>Button</text>
</frame>
<frame name='Button Row' layout='row' gap='16' w='fill' height='hug' bg='transparent' p='24'>
  <ref component='Button' bg='#3B82F6' set:label='Primary'/>
  <ref component='Button' bg='#6B7280' set:label='Secondary'/>
  <ref component='Button' bg='#EF4444' set:label='Danger'/>
</frame>
```

## Before vs After

| Metric | Before Fix | After Fix |
|--------|-----------|-----------|
| INSTANCE nodes created (same-batch) | 0 (would fail) | 3 (Test 3) |
| INSTANCE nodes created (cross-batch) | 0 | 0 (not tested — LLM doesn't use pattern) |
| "Component source not found" errors | 100% on ref calls | 0% (Test 3: all 3 refs succeeded) |
| Fallback to duplicate frames | Always | Not needed (Test 3) |
| componentRegistry code present | No | Yes (module-level Map, persists across execute() calls) |

## Code Verification

The fix in `src/engine/actions/executor.ts` is correctly implemented:

1. **Line 23**: `const componentRegistry = new Map<string, string>()` — module-level, persists across instances
2. **Line 34**: `ActionExecutor.clearComponentRegistry()` — static method for session reset
3. **Line 394**: `componentRegistry.set(action.tempId, comp.id)` — registers on successful createComponent
4. **Line 628-630**: Resolution chain: `tempIdMap` (current batch) -> `componentRegistry` (cross-batch) -> raw ID

## Recommendations

1. **Prompt engineering needed**: The LLM (kimi-k2.5) does not naturally split component definition and instantiation into separate tool calls. It either duplicates the full XML or uses `<ref>` within the same batch. Add explicit examples in `EXAMPLES.md` showing the two-step pattern: first `create` with `reusable='true'`, then a separate `create` using `<ref component='...'>`.

2. **Cross-batch test**: To truly test the `componentRegistry` cross-batch path, a multi-turn test is needed where:
   - Turn 1: "Create a reusable card component"
   - Turn 2: "Now create 3 instances of that card"

   This would force the LLM to use `<ref>` in a separate tool call (different `execute()` invocation).

3. **Same-batch path works**: The `tempIdMap` within a single `execute()` call correctly resolves `<ref>` to the component created earlier in the same XML. This is the path the LLM naturally uses and it works correctly.
