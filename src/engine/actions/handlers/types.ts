/**
 * @file types.ts
 * @description Property handler interface for the executor's extensible property pipeline.
 *
 * Each handler claims specific property keys and knows how to apply them to Figma nodes.
 * Handlers are registered in priority order and matched against incoming props.
 */

export interface Warning {
  code: string;
  severity: 'warning';
  message: string;
  [key: string]: any;
}

/** Diff info for a single property application. */
export interface PropertyDiff {
  key: string;
  changed: boolean;
  before?: any;
  after?: any;
}

/**
 * A PropertyHandler knows how to apply one or more properties to a Figma SceneNode.
 *
 * The pipeline:
 *   1. Sort all (key, value) entries by PROP_ORDER
 *   2. For each entry, find the first handler where `match()` returns true
 *   3. Call `apply()` on that handler
 *   4. If no handler matches, fall through to the default handler (direct assignment)
 */
export interface PropertyHandler {
  /** Human-readable name for logging/debugging */
  readonly name: string;

  /** Return true if this handler should process the given property key. */
  match(key: string, value: any, node: SceneNode): boolean;

  /** Apply the property to the node. Return warnings (never throw). */
  apply(node: SceneNode, key: string, value: any): Promise<Warning[]>;
}
