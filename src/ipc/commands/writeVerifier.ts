/**
 * Post-write verification — detects silent property failures.
 * Snapshots before, reads after, diffs against expected values.
 * Zero LLM cost — pure JS object comparison on Figma main thread.
 */

export interface WriteFailure {
  prop: string;
  expected: any;
  actual: any;
}

/** Read a set of property values from a node. */
export function snapshotProps(node: SceneNode, propNames: string[]): Record<string, any> {
  const snap: Record<string, any> = {};
  for (const prop of propNames) {
    try {
      snap[prop] = (node as any)[prop];
    } catch {
      snap[prop] = undefined;
    }
  }
  return snap;
}

/**
 * Compare written values against actual node state.
 *
 * Rules:
 * - Complex objects (fills, effects, strokes arrays) are skipped — too hard to
 *   deep-compare reliably.
 * - No-op writes (value was already what we wanted) are skipped.
 * - Only primitive / string mismatches are reported.
 */
export function verifyWrites(
  node: SceneNode,
  propsWritten: Record<string, any>,
  snapshotBefore: Record<string, any>,
): WriteFailure[] {
  const failures: WriteFailure[] = [];

  for (const [prop, expected] of Object.entries(propsWritten)) {
    // Skip complex objects (paints, effects, arrays) — deep-compare not reliable
    if (typeof expected === 'object' && expected !== null) continue;

    try {
      const actual = (node as any)[prop];

      // Skip if the value was already what we wanted (no-op write)
      if (snapshotBefore[prop] === expected) continue;

      // Check if write took effect
      if (actual !== expected) {
        failures.push({ prop, expected, actual });
      }
    } catch {
      // Property not readable — skip
    }
  }

  return failures;
}

/**
 * Format write failures as human-readable warning strings.
 * Mentions "instance" when the node is an INSTANCE to hint at component locks.
 */
export function formatWriteWarnings(node: SceneNode, failures: WriteFailure[]): string[] {
  if (failures.length === 0) return [];

  const isInstance = node.type === 'INSTANCE';
  const instanceHint = isInstance
    ? ' This may be an instance whose component locks this property.'
    : '';

  return failures.map(
    ({ prop, expected, actual }) =>
      `Property '${prop}' was not applied (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}).${instanceHint}`,
  );
}
