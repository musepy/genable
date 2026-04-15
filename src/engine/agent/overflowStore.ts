/**
 * @file overflowStore.ts
 * @description Overflow buffer for truncated tool outputs.
 *
 * When a tool result exceeds MAX_OUTPUT_LINES, the full content is saved here.
 * The LLM can retrieve it via `more <id>` or pipe it: `more <id> | grep pattern`.
 *
 * Like memory — progressively discoverable. The LLM sees a truncated preview
 * with a reference, then explores the full content on demand.
 */

const MAX_STORED = 5;

const store = new Map<number, string>();
let nextId = 1;

/**
 * Save full output that was truncated. Returns a numeric ID.
 * Oldest entries are evicted when the store exceeds MAX_STORED.
 */
export function saveOverflow(content: string): number {
  const id = nextId++;
  store.set(id, content);

  // Evict oldest to prevent memory leak
  while (store.size > MAX_STORED) {
    const oldest = Math.min(...store.keys());
    store.delete(oldest);
  }

  return id;
}

/** Retrieve a stored overflow by ID. Returns null if expired/not found. */
export function getOverflow(id: number): string | null {
  return store.get(id) ?? null;
}

/** Clear all stored overflows. Called at run() start. */
export function clearOverflows(): void {
  store.clear();
  nextId = 1;
}
