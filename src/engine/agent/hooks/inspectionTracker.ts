/**
 * @file inspectionTracker.ts
 * @description Pure state tracker for node inspection status.
 *
 * Single-level: a node is either "known" (seen in any inspect/describe/jsx
 * result this turn) or "unknown" (hallucinated ID / never observed).
 *
 * Gate semantics (enforced by inspectGateHook):
 *   - unknown → reject mutation (likely hallucinated ID)
 *   - known   → allow all mutations
 *
 * Rationale: Figma has no dirty-read/concurrency hazards; the meaningful
 * failure mode is LLM hallucinating IDs. Property-level "you must read
 * before edit" gating produced more round-trip cost than safety value.
 *
 * Zero dependencies. No hook logic — consumed by gate and stub hooks.
 */

export interface InspectionTracker {
  /** Mark a node as known (seen in any inspect/describe/jsx result). */
  markInspected(id: string): void;
  /** True if the node has been observed this turn. "/" always true. */
  isInspected(id: string): boolean;
  /** Remove inspection status after successful mutation (dirty flag). */
  consumeInspection(id: string): void;
  /** Clear all state. Called at turn boundary. */
  reset(): void;
}

export function createInspectionTracker(): InspectionTracker {
  const known = new Set<string>();

  return {
    markInspected: (id) => { known.add(id); },
    isInspected: (id) => id === '/' || known.has(id),
    consumeInspection: (id) => { known.delete(id); },
    reset: () => { known.clear(); },
  };
}
