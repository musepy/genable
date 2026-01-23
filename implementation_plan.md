# Semantic Layout Engine Implementation Plan

## Goal Description
Implement a deterministic **Semantic Layout Engine** to replace the current heuristic-based post-processor. This engine will compile high-level Semantic Types (e.g., `BUTTON`, `CARD`) into precise Figma Layout Props based on a standard definition library, eliminating "magic string" guessing and ensuring standardized, constraint-compliant layouts.

## User Review Required
> [!IMPORTANT]
> This is a **Rewrite** of the core layout logic.
> While it removes fragility, it requires strict adherence to the new Schema. Any prompt that doesn't output valid `semantic` tags will fallback to default layouts.

## Proposed Changes

### Core Logic (New)
#### [NEW] [definitions.ts](file:///Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator/src/services/layout/stdLib/definitions.ts)
- Define `SemanticLayoutProfile` interface.
- Implement `SEMANTIC_DEFINITIONS` constant containing rules for all 30+ semantic types.
- Includes `constraints` for Clip Content, Min/Max, etc.

#### [NEW] [compiler.ts](file:///Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator/src/services/layout/compiler.ts)
- Implement `compileLayout(node, profile)` function.
- **Logic**:
    - Map `sizing` -> `layoutSizingHorizontal/Vertical`.
    - Map `gap: "AUTO"` -> `primaryAxisAlignItems: "SPACE_BETWEEN"`.
    - Apply `constraints` (Clip Content, Min/Max).
    - Handle `layoutWrap`.

### Schema Updates
#### [MODIFY] [layerSchema.ts](file:///Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator/src/schema/layerSchema.ts)
- Add `minWidth`, `maxWidth`, `minHeight`, `maxHeight` to `NodeLayerPropsSchema`.
- Ensure `semantic` is strongly typed.

### Integration
#### [MODIFY] [postProcessor/index.ts](file:///Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator/src/services/postProcessor/index.ts)
- **Delete** calls to old heuristic rules.
- **Inject** `SemanticLayoutEngine` step before other rules.

#### [DELETE] Heuristic Rules
- `src/services/postProcessor/rules/layout/PercentageWidthToFillCorrection.ts`
- `src/services/postProcessor/rules/layout/*.ts` (Most layout patches)

## Verification Plan

### Automated Tests
1.  **Unit Tests (`src/services/layout/compiler.test.ts`)**:
    - Test `BUTTON` compilation: assert `layoutSizingHorizontal` is `HUG` and `clipsContent` is `false`.
    - Test `NAV_BAR` compilation: assert `itemSpacing` is `0` and `primaryAxisAlignItems` is `SPACE_BETWEEN`.
    - Test `CARD` compilation: assert `layoutSizingHorizontal` is `FIXED` (or `FILL` if context aware).

### Manual Verification
1.  **Generate "Dashboard"**:
    - Verify `UsageBar` (Nav) spreads items correctly.
    - Verify `StatsCard` wraps children if needed.
2.  **Generate "Form"**:
    - Verify `SubmitButton` hugs text and shows shadow (no clip).
