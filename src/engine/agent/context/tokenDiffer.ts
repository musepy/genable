/**
 * @file tokenDiffer.ts
 * @description Compares design token snapshots and generates natural language summaries.
 * V1: value-level diff only. Rename detection and multi-mode diffing are V2.
 */

export interface TokenSnapshot {
  colors: Record<string, string>;    // scale/step → hex (single mode for V1)
  fonts: Record<string, string>;     // role → "family/size/weight"
  spacing: Record<string, number>;   // name → px value
  timestamp: string;                 // ISO 8601
}

export interface TokenDiffResult {
  hasChanges: boolean;
  summary: string;           // natural language summary
  added: string[];           // new keys
  removed: string[];         // deleted keys
  changed: string[];         // modified keys
}

/**
 * Compare two token snapshots and produce a human-readable diff summary.
 * Returns null if prev is null/undefined (first run — skip diff).
 */
export function diffTokenSnapshots(
  prev: TokenSnapshot | null | undefined,
  current: TokenSnapshot
): TokenDiffResult | null {
  if (!prev) return null;

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  // Diff colors
  diffRecord(prev.colors, current.colors, 'color', added, removed, changed);

  // Diff fonts
  diffRecord(prev.fonts, current.fonts, 'font', added, removed, changed);

  // Diff spacing
  diffNumberRecord(prev.spacing, current.spacing, 'spacing', added, removed, changed);

  const hasChanges = added.length > 0 || removed.length > 0 || changed.length > 0;

  return {
    hasChanges,
    summary: hasChanges ? buildSummary(added, removed, changed) : 'No design system changes since last session.',
    added,
    removed,
    changed,
  };
}

function diffRecord(
  prev: Record<string, string>,
  curr: Record<string, string>,
  category: string,
  added: string[],
  removed: string[],
  changed: string[]
): void {
  const prevKeys = new Set(Object.keys(prev));
  const currKeys = new Set(Object.keys(curr));

  for (const key of currKeys) {
    if (!prevKeys.has(key)) {
      added.push(`${category}: ${key} (${curr[key]})`);
    } else if (prev[key] !== curr[key]) {
      changed.push(`${category}: ${key} changed from ${prev[key]} to ${curr[key]}`);
    }
  }

  for (const key of prevKeys) {
    if (!currKeys.has(key)) {
      removed.push(`${category}: ${key}`);
    }
  }
}

function diffNumberRecord(
  prev: Record<string, number>,
  curr: Record<string, number>,
  category: string,
  added: string[],
  removed: string[],
  changed: string[]
): void {
  const prevKeys = new Set(Object.keys(prev));
  const currKeys = new Set(Object.keys(curr));

  for (const key of currKeys) {
    if (!prevKeys.has(key)) {
      added.push(`${category}: ${key} (${curr[key]}px)`);
    } else if (prev[key] !== curr[key]) {
      changed.push(`${category}: ${key} changed from ${prev[key]}px to ${curr[key]}px`);
    }
  }

  for (const key of prevKeys) {
    if (!currKeys.has(key)) {
      removed.push(`${category}: ${key}`);
    }
  }
}

function buildSummary(added: string[], removed: string[], changed: string[]): string {
  const parts: string[] = [];

  if (added.length > 0) {
    parts.push(`Added: ${added.join(', ')}`);
  }
  if (removed.length > 0) {
    parts.push(`Removed: ${removed.join(', ')}`);
  }
  if (changed.length > 0) {
    parts.push(`Changed: ${changed.join(', ')}`);
  }

  return `Design system changes since last session: ${parts.join('. ')}.`;
}
