/**
 * @file mutationDiff.ts
 * @description Compares intended property changes with the actual state of a node to detect "silent corrections" by Figma.
 *
 * Messages are classified as:
 * - actionable: The agent can and should fix these (e.g., execution order issues)
 * - informational: Figma's legitimate auto-corrections that cannot be "fixed" by retrying
 *   (e.g., TEXT nodes don't support auto-layout). Reporting these as errors causes repair loops.
 */

export interface DiffResult {
  hasDiscrepancy: boolean;
  /** All diff messages (backward compat) */
  messages: string[];
  /** Issues the agent can address (e.g., reorder operations, change parent first) */
  actionable: string[];
  /** Figma's legitimate corrections — DO NOT retry, just inform */
  informational: string[];
}

export function diffIntendedVsActual(intended: any, actual: any): DiffResult {
  const actionable: string[] = [];
  const informational: string[] = [];

  if (!intended || !actual) return { hasDiscrepancy: false, messages: [], actionable: [], informational: [] };

  const nodeType = actual.type || actual.props?.type;

  // 1. Layout Mode silent correction
  if (intended.layoutMode && intended.layoutMode !== 'NONE' && actual.props?.layoutMode === 'NONE') {
    if (nodeType === 'TEXT') {
      // TEXT nodes fundamentally don't support auto-layout — this is not fixable
      informational.push(`layoutMode: intended '${intended.layoutMode}', but TEXT nodes do not support auto-layout. Figma auto-corrected to 'NONE'. No action needed.`);
    } else {
      actionable.push(`layoutMode: intended '${intended.layoutMode}', but Figma reset to 'NONE' (likely due to child constraints or invalid container type).`);
    }
  }

  // 2. Padding/Gap ignored when layoutMode is NONE
  if (intended.gap !== undefined && intended.gap !== actual.props?.gap) {
    if (actual.props?.layoutMode === 'NONE') {
      // Gap requires auto-layout — if layoutMode is NONE this is a structural constraint
      informational.push(`gap: '${intended.gap}' ignored because layoutMode is 'NONE'. Set layoutMode first, then gap.`);
    }
  }

  // 3. Sizing (FILL/HUG)
  const intendedSizing = intended.sizing || {};
  const actualSizing = actual.props?.sizing || {};

  if (intendedSizing.horizontal === 'FILL' && actualSizing.horizontal !== 'FILL') {
    const parentHasAutoLayout = actual.parent?.props?.layoutMode && actual.parent.props.layoutMode !== 'NONE';
    if (parentHasAutoLayout) {
      // Parent has auto-layout but FILL didn't stick — possible execution order issue
      actionable.push(`horizontalSizing: intended 'FILL', but is '${actualSizing.horizontal || 'FIXED'}'. Parent has auto-layout — may be an execution order issue.`);
    } else {
      // Parent lacks auto-layout — structural constraint, not fixable by retrying
      informational.push(`horizontalSizing: intended 'FILL', but is '${actualSizing.horizontal || 'FIXED'}'. Parent lacks auto-layout — FILL requires parent layoutMode HORIZONTAL or VERTICAL.`);
    }
  }
  if (intendedSizing.vertical === 'FILL' && actualSizing.vertical !== 'FILL') {
    const parentHasAutoLayout = actual.parent?.props?.layoutMode && actual.parent.props.layoutMode !== 'NONE';
    if (parentHasAutoLayout) {
      actionable.push(`verticalSizing: intended 'FILL', but is '${actualSizing.vertical || 'FIXED'}'. Parent has auto-layout — may be an execution order issue.`);
    } else {
      informational.push(`verticalSizing: intended 'FILL', but is '${actualSizing.vertical || 'FIXED'}'. Parent lacks auto-layout — FILL requires parent layoutMode HORIZONTAL or VERTICAL.`);
    }
  }

  const messages = [...actionable, ...informational];

  return {
    hasDiscrepancy: messages.length > 0,
    messages,
    actionable,
    informational
  };
}
