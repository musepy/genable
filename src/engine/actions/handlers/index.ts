/**
 * @file handlers/index.ts
 * @description Property handler registry — extensible pipeline for applying properties to Figma nodes.
 *
 * To add a new property handler:
 *   1. Create a new file (e.g., variableHandler.ts) implementing PropertyHandler
 *   2. Import and add it to HANDLERS array below (before defaultHandler)
 *   3. Done — no changes to executor.ts needed
 */

import { PropertyHandler, Warning, PropertyDiff } from './types';
import { paintHandler } from './paintHandler';
import { effectHandler } from './effectHandler';
import { unitValueHandler } from './unitValueHandler';
import { resizeHandler } from './resizeHandler';
import { constraintsHandler } from './constraintsHandler';
import { dashPatternHandler } from './dashPatternHandler';
import { defaultHandler } from './defaultHandler';

/**
 * Ordered list of property handlers. First match wins.
 * defaultHandler MUST be last — it catches any property that exists on the node.
 */
const HANDLERS: PropertyHandler[] = [
  paintHandler,
  effectHandler,
  unitValueHandler,
  resizeHandler,
  constraintsHandler,
  dashPatternHandler,
  // ↑ Add new handlers above this line
  defaultHandler,
];

/** Result of applying a single property — includes diff information. */
export interface ApplyPropertyResult {
  warnings: Warning[];
  diff: PropertyDiff;
}

/**
 * Read the current value of a property from a node.
 * Returns undefined for properties that can't be read (e.g., write-only).
 */
function readCurrentValue(node: SceneNode, key: string): any {
  try {
    return (node as any)[key];
  } catch {
    return undefined;
  }
}

/**
 * Shallow equality check for Figma property values.
 * Handles primitives, arrays, and simple objects (Paint[], Effect[], constraints, etc.)
 */
function valuesEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== typeof b) return false;

  // Numbers: use tolerance for floats
  if (typeof a === 'number') return Math.abs(a - b) < 0.01;

  // Arrays (Paint[], Effect[], dashPattern, etc.)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => valuesEqual(item, b[i]));
  }

  // Objects (constraints, unit values, etc.)
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => valuesEqual(a[k], b[k]));
  }

  return false;
}

/** Format a value for human-readable diff display. */
function formatValue(value: any): string {
  if (value == null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    // Paint arrays: show color shorthand
    if (value.length > 0 && value[0]?.type === 'SOLID') {
      const c = value[0].color;
      if (c) {
        const hex = `#${Math.round(c.r * 255).toString(16).padStart(2, '0')}${Math.round(c.g * 255).toString(16).padStart(2, '0')}${Math.round(c.b * 255).toString(16).padStart(2, '0')}`.toUpperCase();
        return hex;
      }
    }
    return `[${value.length} items]`;
  }
  if (typeof value === 'object') {
    // Constraints: show compact
    if ('horizontal' in value && 'vertical' in value) {
      return `${value.horizontal},${value.vertical}`;
    }
    // Unit value: show compact
    if ('unit' in value && 'value' in value) {
      return `${value.value}${value.unit === 'PERCENT' ? '%' : 'px'}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Apply a single property to a node using the handler pipeline.
 * Returns warnings and diff information (before/after comparison).
 */
export async function applyProperty(
  node: SceneNode,
  key: string,
  value: any,
): Promise<ApplyPropertyResult> {
  for (const handler of HANDLERS) {
    if (handler.match(key, value, node)) {
      // Capture before value
      const before = readCurrentValue(node, key);

      // Apply via handler
      const warnings = await handler.apply(node, key, value);

      // Capture after value
      const after = readCurrentValue(node, key);

      // Determine if value actually changed
      const changed = !valuesEqual(before, after);

      return {
        warnings,
        diff: { key, changed, before, after },
      };
    }
  }

  // No handler matched (property doesn't exist on node)
  return {
    warnings: [{
      code: 'UNSUPPORTED_PROP',
      severity: 'warning',
      message: `Skipped unsupported property '${key}' on ${node.type} node`,
    }],
    diff: { key, changed: false },
  };
}

/** Export for testing / external registration. */
export { HANDLERS, formatValue, valuesEqual };
export type { PropertyHandler, Warning, PropertyDiff } from './types';
