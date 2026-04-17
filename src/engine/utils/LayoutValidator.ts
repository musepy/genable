/**
 * @file LayoutValidator.ts
 * @description Pure functions for Figma layout sizing validation.
 * Consolidates HUG/FILL/FIXED constraint rules shared across renderers.
 */

export type SizingMode = 'FIXED' | 'HUG' | 'FILL';

export interface NormalizeSizingContext {
  hasAutoLayout: boolean;
  parentHasAutoLayout: boolean;
  isRoot: boolean;
  /** True when this node's layoutMode === 'GRID'. Grid containers cannot HUG
   *  while any track is FLEX (the default), so HUG demotes to FIXED. */
  isGridContainer?: boolean;
}

/** Check if a node is absolutely positioned within an auto-layout parent */
export function isAbsolutePositioned(props: any): boolean {
  return String(props?.layoutPositioning || '').toUpperCase() === 'ABSOLUTE';
}

/**
 * Normalize HUG/FILL/FIXED sizing modes to comply with Figma constraints:
 * - HUG requires Auto Layout on the node itself
 * - FILL requires Auto Layout on the parent
 * - Root nodes without Auto Layout are always FIXED
 */
export function normalizeSizing(
  hSizing: SizingMode,
  vSizing: SizingMode,
  ctx: NormalizeSizingContext
): { h: SizingMode; v: SizingMode } {
  let h = hSizing;
  let v = vSizing;

  // Rule 1: Root without layoutMode → FIXED
  if (ctx.isRoot && !ctx.hasAutoLayout) {
    return { h: 'FIXED', v: 'FIXED' };
  }

  // Rule 2: HUG requires layoutMode on node.
  // After the DSL fail-fast cleanup (April 2026), the only surviving path to
  // this branch is: LLM writes `sizingH: HUG` (or HUG-native) but forgets
  // `layout`. Emit a diagnostic so telemetry can prove reachability — if no
  // hits over time, this safety net can be deleted outright.
  if (!ctx.hasAutoLayout) {
    if (h === 'HUG') {
      console.warn('[LayoutValidator] HUG→FIXED: node has no layoutMode. Add `layout: "row|column|grid"` to use HUG sizing.');
      h = 'FIXED';
    }
    if (v === 'HUG') {
      console.warn('[LayoutValidator] HUG→FIXED: node has no layoutMode. Add `layout: "row|column|grid"` to use HUG sizing.');
      v = 'FIXED';
    }
  }

  // Rule 3: FILL requires layoutMode on parent.
  // Demote to HUG if node itself has auto-layout (HUG is valid on auto-layout frames),
  // otherwise FIXED (the only universally safe mode).
  if (!ctx.parentHasAutoLayout) {
    if (h === 'FILL') h = ctx.hasAutoLayout ? 'HUG' : 'FIXED';
    if (v === 'FILL') v = ctx.hasAutoLayout ? 'HUG' : 'FIXED';
  }

  // Rule 4: Double-check after FILL→HUG demotion
  if (!ctx.hasAutoLayout) {
    if (h === 'HUG') h = 'FIXED';
    if (v === 'HUG') v = 'FIXED';
  }

  // Rule 5: GRID containers can't HUG with FLEX tracks (the default). Demote
  // to FIXED so resize() on the container produces a deterministic size.
  if (ctx.isGridContainer) {
    if (h === 'HUG') h = 'FIXED';
    if (v === 'HUG') v = 'FIXED';
  }

  return { h, v };
}

/**
 * Calculate flex fallback properties for FILL sizing in auto-layout contexts.
 * - Primary axis FILL → layoutGrow = 1
 * - Counter axis FILL → layoutAlign = 'STRETCH'
 */
export function getFlexFallbacks(
  hSizing: SizingMode,
  vSizing: SizingMode,
  parentLayoutMode?: string
): { layoutGrow?: number; layoutAlign?: 'STRETCH' } {
  const result: { layoutGrow?: number; layoutAlign?: 'STRETCH' } = {};
  if (parentLayoutMode === 'HORIZONTAL' && hSizing === 'FILL') result.layoutGrow = 1;
  if (parentLayoutMode === 'VERTICAL' && vSizing === 'FILL') result.layoutGrow = 1;
  if (parentLayoutMode === 'HORIZONTAL' && vSizing === 'FILL') result.layoutAlign = 'STRETCH';
  if (parentLayoutMode === 'VERTICAL' && hSizing === 'FILL') result.layoutAlign = 'STRETCH';
  return result;
}
