/**
 * @file memoryStore.ts
 * @description Persistent memory store for the agent, backed by figma.clientStorage.
 *
 * Virtual path: /.agent/memory/<key>
 * Storage: figma.clientStorage with "mem:" prefix to avoid collisions with settings.
 * Index: a separate key "_mem_index" tracks all memory keys.
 *
 * Supports: list, get, set, delete — all async (clientStorage is async).
 */

const PREFIX = 'mem:';
const INDEX_KEY = '_mem_index';

// ── Index management ──

async function loadIndex(): Promise<string[]> {
  const raw = await figma.clientStorage.getAsync(INDEX_KEY);
  if (!raw || !Array.isArray(raw)) return [];
  return raw as string[];
}

async function saveIndex(keys: string[]): Promise<void> {
  await figma.clientStorage.setAsync(INDEX_KEY, keys);
}

// ── Public API ──

/** List all memory keys. */
export async function memoryList(): Promise<string[]> {
  return loadIndex();
}

/** Get a memory value by key. Returns undefined if not found. */
export async function memoryGet(key: string): Promise<string | undefined> {
  const val = await figma.clientStorage.getAsync(PREFIX + key);
  return val ?? undefined;
}

/** Get all memories as { key: value } map. */
export async function memoryGetAll(): Promise<Record<string, string>> {
  const keys = await loadIndex();
  const result: Record<string, string> = {};
  for (const key of keys) {
    const val = await figma.clientStorage.getAsync(PREFIX + key);
    if (val !== undefined && val !== null) {
      result[key] = val;
    }
  }
  return result;
}

/** Set a memory value. Creates or updates. */
export async function memorySet(key: string, value: string): Promise<void> {
  try {
    await figma.clientStorage.setAsync(PREFIX + key, value);
    const index = await loadIndex();
    if (!index.includes(key)) {
      index.push(key);
      await saveIndex(index);
    }
  } catch (e) {
    console.warn('[memoryStore] Failed to write memory:', key, e);
  }
}

/** Delete a memory by key. Returns true if existed. */
export async function memoryDelete(key: string): Promise<boolean> {
  try {
    const index = await loadIndex();
    const existed = index.includes(key);
    if (existed) {
      await figma.clientStorage.deleteAsync(PREFIX + key);
      await saveIndex(index.filter(k => k !== key));
    }
    return existed;
  } catch (e) {
    console.warn('[memoryStore] Failed to delete memory:', key, e);
    return false;
  }
}

/** Clear all memories. */
export async function memoryClear(): Promise<void> {
  const index = await loadIndex();
  await Promise.all(index.map(k => figma.clientStorage.deleteAsync(PREFIX + k)));
  await saveIndex([]);
}
