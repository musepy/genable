/**
 * @file store.ts
 * @description In-memory scratchpad — session-scoped working memory for the agent.
 * Stores intermediate data (node IDs, layout plans, color values) that must survive
 * across iterations within a turn but NOT persist across sessions.
 *
 * Lives in sandbox thread — zero IPC latency.
 */

const MAX_ENTRIES = 50;
const MAX_VALUE_LENGTH = 10000;

const store = new Map<string, string>();

export function scratchList(): string[] {
  return [...store.keys()];
}

export function scratchGet(key: string): string | undefined {
  return store.get(key);
}

export function scratchGetAll(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of store) {
    result[k] = v;
  }
  return result;
}

export function scratchSet(key: string, value: string): { error?: string } {
  if (!key) return { error: 'Key is required' };
  if (value.length > MAX_VALUE_LENGTH) {
    return { error: `Value too long (${value.length} chars, max ${MAX_VALUE_LENGTH})` };
  }
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    return { error: `Scratchpad full (${MAX_ENTRIES} entries). Delete some entries first.` };
  }
  store.set(key, value);
  return {};
}

export function scratchDelete(key: string): boolean {
  return store.delete(key);
}

export function scratchClear(): void {
  store.clear();
}
