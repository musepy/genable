# Silent Defaults: Testing Checklist

Compiler/executor silently fixes Figma API defaults that don't match design intent.
Every E2E test run should验证这些兜底是否生效，并监控是否引入副作用.

## Active Silent Defaults

### 1. clipsContent → false (auto-layout frames)
- **File**: `src/engine/actions/compiler.ts` — `applySizingDefaults()`
- **Condition**: frame has `layoutMode` && `clipsContent` undefined
- **Default**: `clipsContent = false`
- **Why**: Figma defaults true, but auto-layout containers clip child shadows/effects
- **Test metric**: count `layout+clips=true`, should be 0 or near 0
- **Status (2026-03-09)**: 1/285 frames — effective

### 2. layoutSizingHorizontal → FILL (child frames)
- **File**: `src/engine/actions/compiler.ts` — `applySizingDefaults()`
- **Condition**: child frame, no explicit width, no explicit `layoutSizingHorizontal`
- **Default**: `layoutSizingHorizontal = 'FILL'`
- **Why**: Figma defaults 100px fixed width, child frames should stretch to parent
- **Test metric**: count child frames with exactly 100px width, should be 0 or near 0
- **Status (2026-03-09)**: 1-2/313 frames — effective

### 3. layoutSizingVertical → HUG (auto-layout frames)
- **File**: `src/engine/actions/compiler.ts` — `applySizingDefaults()`
- **Condition**: frame has `layoutMode`, no explicit height, no explicit `layoutSizingVertical`
- **Default**: `layoutSizingVertical = 'HUG'`
- **Why**: Figma defaults 100px fixed height, auto-layout frames should wrap content
- **Test metric**: count auto-layout frames with exactly 100px height, should be 0 or near 0
- **Status (2026-03-09)**: effective (few 100px height observed)

### 4. textAutoResize → HEIGHT (child text nodes)
- **File**: `src/engine/actions/compiler.ts` — `compileCreate()` TEXT branch
- **Condition**: text node has parent, no explicit `textAutoResize`
- **Default**: `textAutoResize = 'HEIGHT'`
- **Why**: Figma defaults WIDTH_AND_HEIGHT (no wrapping, text grows infinitely wide). HEIGHT enables wrapping within parent width.
- **Test metric**: count text nodes with `textAutoResize=WIDTH_AND_HEIGHT`, should be <20% (was 83% before fix)
- **Edge case to watch**: button labels in HUG containers — if text becomes HEIGHT, width no longer auto-expands. Verify buttons still render correctly.
- **Status (2026-03-09)**: just added, pending verification

## Testing Protocol

For each E2E test run, scan `tree.json` and report:

```
Frames:
  clipsContent: true=N, false=N (layout+clips=N)
  child frames with 100px width: N
  auto-layout frames with 100px height: N

Text:
  textAutoResize: WIDTH_AND_HEIGHT=N, HEIGHT=N, NONE=N, TRUNCATE=N
  overflow detected: N
```

Compare against baselines above. If numbers regress, investigate whether:
1. LLM explicitly set the value (intended) — OK
2. Silent default not applied (code regression) — fix
3. New edge case exposed — document and decide

## Previously Investigated (Not Issues)

- **align props without layoutMode**: All 80 instances were Figma default `MIN/MIN` on every frame. Not an LLM omission. No fix needed.
