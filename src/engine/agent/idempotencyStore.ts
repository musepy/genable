/**
 * @file idempotencyStore.ts
 * @description Run-scoped idempotency cache for non-idempotent tools (e.g. build_design).
 *
 * Key format: `${runId}:${toolCallId}`
 * Each entry stores a requestHash (normalized hash of the request params) and the cached result.
 * On cache hit with matching hash → return cached result (no re-execution).
 * On cache hit with different hash → return IDEMPOTENCY_KEY_CONFLICT error.
 */

// ---------------------------------------------------------------------------
// Hash utility
// ---------------------------------------------------------------------------

/**
 * Computes a simple but collision-resistant hash for a canonical request string.
 * Uses FNV-1a 32-bit — fast, deterministic, no crypto dependency.
 */
export function computeRequestHash(canonicalParams: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < canonicalParams.length; i++) {
    hash ^= canonicalParams.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // FNV prime, keep as uint32
  }
  return hash.toString(36);
}

/**
 * Normalizes build_design params into a canonical string for hashing.
 * Only includes fields that affect execution outcome.
 */
export function canonicalizeBuildDesignParams(params: {
  operations: any[];
  parentId?: string;
  onError?: string;
  rollbackMode?: string;
}): string {
  return JSON.stringify({
    operations: params.operations,
    parentId: params.parentId ?? null,
    onError: params.onError ?? 'continue',
    rollbackMode: params.rollbackMode ?? 'none',
  });
}

// ---------------------------------------------------------------------------
// Store entry
// ---------------------------------------------------------------------------

interface IdempotencyEntry {
  requestHash: string;
  result: any;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// IdempotencyStore
// ---------------------------------------------------------------------------

export class IdempotencyStore {
  private store = new Map<string, IdempotencyEntry>();
  private currentRunId = '';

  constructor(
    private readonly maxEntries: number = 50,
    private readonly ttlMs: number = 30 * 60 * 1000, // 30 minutes
  ) {}

  /**
   * Set the current run ID. Clears all entries from previous runs.
   */
  setRunId(runId: string): void {
    if (runId !== this.currentRunId) {
      this.store.clear();
      this.currentRunId = runId;
    }
  }

  /**
   * Build the composite key from runId + toolCallId.
   */
  makeKey(toolCallId: string): string {
    return `${this.currentRunId}:${toolCallId}`;
  }

  /**
   * Check if a cached result exists for this key.
   *
   * Returns:
   * - { hit: true, result } on cache hit with matching hash
   * - { hit: false, conflict: true, oldHash, newHash } on hash mismatch
   * - { hit: false } on cache miss
   */
  check(
    key: string,
    requestHash: string,
  ): IdempotencyCheckResult {
    const entry = this.store.get(key);
    if (!entry) {
      return { hit: false };
    }

    // TTL expiry
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.store.delete(key);
      return { hit: false };
    }

    // Hash mismatch → conflict
    if (entry.requestHash !== requestHash) {
      return {
        hit: false,
        conflict: true,
        oldHash: entry.requestHash,
        newHash: requestHash,
      };
    }

    // Cache hit
    return { hit: true, result: entry.result };
  }

  /**
   * Store a result after successful execution.
   */
  set(key: string, requestHash: string, result: any): void {
    // LRU eviction: remove oldest entry if at capacity
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, {
      requestHash,
      result,
      createdAt: Date.now(),
    });
  }

  /** Number of cached entries (for testing/debugging). */
  get size(): number {
    return this.store.size;
  }

  /** Clear all entries. */
  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type IdempotencyCheckResult =
  | { hit: true; result: any }
  | { hit: false; conflict?: false }
  | { hit: false; conflict: true; oldHash: string; newHash: string };
