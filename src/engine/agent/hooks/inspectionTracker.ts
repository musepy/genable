/**
 * @file inspectionTracker.ts
 * @description Pure state tracker for node inspection status.
 *
 * Owns a Set<string> of "clean" (inspected) node IDs.
 * - inspect/describe → markInspected (clean)
 * - mutation tool    → consumeInspection (dirty)
 * - jsx creation     → markInspected (born clean)
 * - "/" (page root)  → always clean (exempt)
 *
 * Zero dependencies. No hook logic — consumed by gate and stub hooks.
 */

export interface InspectionTracker {
  /** Mark a node as inspected (clean). Called by inspect/describe/jsx. */
  markInspected(id: string): void;
  /** Check if a node has been inspected. "/" is always true. */
  isInspected(id: string): boolean;
  /** Remove inspection status (dirty flag). Called after successful mutation. */
  consumeInspection(id: string): void;
  /** Clear all state. Called at turn boundary. */
  reset(): void;
}

export function createInspectionTracker(): InspectionTracker {
  const inspected = new Set<string>();

  return {
    markInspected: (id) => { inspected.add(id); },
    isInspected: (id) => id === '/' || inspected.has(id),
    consumeInspection: (id) => { inspected.delete(id); },
    reset: () => { inspected.clear(); },
  };
}
