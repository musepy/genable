/**
 * @file handlers/index.ts
 * @description Property handler registry — extensible pipeline for applying properties to Figma nodes.
 *
 * To add a new property handler:
 *   1. Create a new file (e.g., variableHandler.ts) implementing PropertyHandler
 *   2. Import and add it to HANDLERS array below (before defaultHandler)
 *   3. Done — no changes to executor.ts needed
 */

import { PropertyHandler, Warning } from './types';
import { paintHandler } from './paintHandler';
import { effectHandler } from './effectHandler';
import { unitValueHandler } from './unitValueHandler';
import { resizeHandler } from './resizeHandler';
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
  // ↑ Add new handlers above this line
  defaultHandler,
];

/**
 * Apply a single property to a node using the handler pipeline.
 * Returns warnings (never throws for known property errors).
 */
export async function applyProperty(
  node: SceneNode,
  key: string,
  value: any,
): Promise<Warning[]> {
  for (const handler of HANDLERS) {
    if (handler.match(key, value, node)) {
      return handler.apply(node, key, value);
    }
  }

  // No handler matched (property doesn't exist on node)
  return [{
    code: 'UNSUPPORTED_PROP',
    severity: 'warning',
    message: `Skipped unsupported property '${key}' on ${node.type} node`,
  }];
}

/** Export for testing / external registration. */
export { HANDLERS };
export type { PropertyHandler, Warning } from './types';
