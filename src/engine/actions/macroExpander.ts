/**
 * @file macroExpander.ts
 * @description Action-level macro expansion — transforms 1 action into N actions.
 *
 * Unlike expandShorthands (property-level: 1 prop → N props on same node),
 * macros generate additional actions (new nodes).
 *
 * Runs BEFORE topological sort in executor.execute().
 *
 * Currently supported macros:
 * - Grid: layout:'grid' cols:N → parent row frame + N fill children
 * - Outline with offset: outlineOffset:N → wrapper frame with stroke
 */

import type { FigmaAction } from './types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MacroResult {
  /** Replacement actions (replaces the original action) */
  actions: FigmaAction[];
  /** Whether a macro was applied */
  expanded: boolean;
}

type Macro = (action: FigmaAction) => MacroResult | null;

// ─── Grid Macro ──────────────────────────────────────────────────────────────

/**
 * Detects layout:'grid' + cols:N on a createFrame action.
 * Expands into: parent row frame + N fill child frames.
 *
 * Input:  { action: 'createFrame', tempId: 'g1', props: { layout: 'grid', cols: 3, gap: 16, ... } }
 * Output: [
 *   { action: 'createFrame', tempId: 'g1', props: { layout: 'row', gap: 16, w: 'fill', ... } },
 *   { action: 'createFrame', parentId: 'g1', tempId: 'g1_col0', props: { w: 'fill' } },
 *   { action: 'createFrame', parentId: 'g1', tempId: 'g1_col1', props: { w: 'fill' } },
 *   { action: 'createFrame', parentId: 'g1', tempId: 'g1_col2', props: { w: 'fill' } },
 * ]
 *
 * Advanced: cols can be a string like "200 1fr 300" for mixed widths.
 */
const gridMacro: Macro = (action) => {
  if (action.action !== 'createFrame') return null;
  const props = (action as any).props;
  if (!props) return null;

  const layout = String(props.layout ?? '').toLowerCase();
  if (layout !== 'grid') return null;

  const cols = props.cols;
  if (!cols) return null;

  // Parse column definitions
  const colDefs = parseColDefs(cols);
  if (colDefs.length === 0) return null;

  const parentTempId = action.tempId ?? `grid_${Date.now()}`;

  // Build parent frame props — remove grid-specific keys, set as row
  const parentProps = { ...props };
  delete parentProps.layout;
  delete parentProps.cols;
  delete parentProps.rows;
  parentProps.layout = 'row';
  // Default to fill width if not specified
  if (!parentProps.w && !parentProps.width && !parentProps.sizingH && !parentProps.sizing) {
    parentProps.w = 'fill';
  }

  const parentAction: FigmaAction = {
    ...action,
    tempId: parentTempId,
    props: parentProps,
  } as any;

  // Build child frame actions
  const childActions: FigmaAction[] = colDefs.map((colDef, i) => ({
    action: 'createFrame' as const,
    tempId: `${parentTempId}_col${i}`,
    parentId: parentTempId,
    dependsOn: [parentTempId],
    props: colDef,
  } as any));

  return {
    actions: [parentAction, ...childActions],
    expanded: true,
  };
};

/**
 * Parse column definitions.
 * - Number: 3 → [fill, fill, fill]
 * - String "1fr 1fr 1fr" → [fill, fill, fill]
 * - String "200 1fr 300" → [w:200, fill, w:300]
 * - Array: [200, '1fr', 300] → [w:200, fill, w:300]
 */
function parseColDefs(cols: any): Record<string, any>[] {
  // Simple number: N equal columns
  if (typeof cols === 'number') {
    return Array.from({ length: cols }, () => ({ w: 'fill' }));
  }

  // String: space-separated column defs
  if (typeof cols === 'string') {
    const parts = cols.trim().split(/\s+/);
    // All numbers? treat as count
    if (parts.length === 1 && /^\d+$/.test(parts[0])) {
      return Array.from({ length: parseInt(parts[0], 10) }, () => ({ w: 'fill' }));
    }
    return parts.map(parseColPart);
  }

  // Array
  if (Array.isArray(cols)) {
    return cols.map(parseColPart);
  }

  return [];
}

function parseColPart(part: any): Record<string, any> {
  const s = String(part).trim().toLowerCase();
  if (s === '1fr' || s === 'fr' || s === 'fill' || s === 'auto') {
    return { w: 'fill' };
  }
  const n = parseFloat(s);
  if (!isNaN(n)) {
    return { w: n };
  }
  return { w: 'fill' };
}

// ─── Outline Offset Macro ────────────────────────────────────────────────────

/**
 * Detects outlineOffset:N on any create action.
 * Wraps the node with a frame that has stroke + OUTSIDE + enlarged radius.
 *
 * Input:  { action: 'createFrame', tempId: 'btn', props: { outline: '#0066ff 2', outlineOffset: 4, radius: 8, ... } }
 * Output: [
 *   original action (with outline/outlineOffset removed),
 *   { action: 'createFrame', parentId: 'btn', tempId: 'btn_outline',
 *     props: { positioning: 'ABSOLUTE', constraints: 'STRETCH,STRETCH',
 *              stroke: '#0066ff 2 outside', radius: 12, fill: 'transparent' } },
 * ]
 */
const outlineOffsetMacro: Macro = (action) => {
  const props = (action as any).props;
  if (!props) return null;
  if (props.outlineOffset === undefined) return null;

  const offset = Number(props.outlineOffset);
  if (isNaN(offset) || offset <= 0) return null;

  // Extract outline props
  const outlineValue = props.outline;
  if (!outlineValue) return null;

  // Parse outline string for color and weight
  let outlineColor = '#000000';
  let outlineWeight = 1;
  if (typeof outlineValue === 'string') {
    for (const p of outlineValue.trim().split(/\s+/)) {
      if (p.startsWith('#')) outlineColor = p;
      else if (/^\d/.test(p)) outlineWeight = parseFloat(p);
    }
  }

  // Get the node's corner radius for the outline frame
  const nodeRadius = props.radius ?? props.cornerRadius ?? 0;
  const outlineRadius = typeof nodeRadius === 'number' ? nodeRadius + offset : nodeRadius;

  const parentTempId = action.tempId ?? (action as any).nodeId;
  if (!parentTempId) return null;

  const outlineTempId = `${parentTempId}_outline`;

  // Remove outline props from original action
  const cleanProps = { ...props };
  delete cleanProps.outline;
  delete cleanProps.outlineOffset;

  const originalAction: FigmaAction = {
    ...action,
    props: cleanProps,
  } as any;

  // The outline needs the parent to be auto-layout for absolute positioning
  // Ensure the original node has auto-layout if it doesn't already
  if (!cleanProps.layout && !cleanProps.layoutMode) {
    cleanProps.layout = 'column';
  }

  const outlineAction: FigmaAction = {
    action: 'createFrame' as const,
    tempId: outlineTempId,
    parentId: parentTempId,
    dependsOn: [parentTempId],
    props: {
      positioning: 'ABSOLUTE',
      constraints: 'STRETCH,STRETCH',
      stroke: `${outlineColor} ${outlineWeight} outside`,
      radius: outlineRadius,
      fill: 'transparent',
      // Negative inset to expand beyond parent bounds by offset amount
      // This is done via x/y offset since constraints STRETCH matches parent size
    },
  } as any;

  return {
    actions: [originalAction, outlineAction],
    expanded: true,
  };
};

// ─── Registry ────────────────────────────────────────────────────────────────

const MACROS: Macro[] = [gridMacro, outlineOffsetMacro];

// ─── Main Function ───────────────────────────────────────────────────────────

/**
 * Expand action-level macros.
 * Each action is passed through all registered macros (first match wins).
 * Returns the expanded action list (unchanged actions pass through as-is).
 */
export function expandMacros(actions: FigmaAction[]): FigmaAction[] {
  const result: FigmaAction[] = [];

  for (const action of actions) {
    let expanded = false;
    for (const macro of MACROS) {
      const macroResult = macro(action);
      if (macroResult?.expanded) {
        result.push(...macroResult.actions);
        expanded = true;
        break;
      }
    }
    if (!expanded) {
      result.push(action);
    }
  }

  return result;
}
