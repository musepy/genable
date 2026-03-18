/**
 * @file node-normalizers.ts
 * @description Context-dependent property validation that runs after shorthand
 * expansion. Handles node-type constraints, enum validation, and text-specific sync.
 *
 * Shorthand expansion (layout→layoutMode, fill→fills, padding, etc.) is now
 * handled by expandShorthands.ts — the single source of truth for property translation.
 * This file only handles validation that requires nodeType or isCreate context.
 */

import { PROP_METADATA, TEXT_ONLY_PROPS, KNOWN_PROP_KEYS } from '../constants/figma-api';
import { expandShorthands, SHORTHAND_KEYS } from '../engine/actions/expandShorthands';

const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, '');

// ── Property suggestion (Levenshtein) ────────────────────────────────────────

/** All accepted property names: canonical + shorthands. Cached once. */
let _allPropNames: string[] | null = null;
function getAllPropNames(): string[] {
  if (!_allPropNames) {
    const s = new Set<string>([...KNOWN_PROP_KEYS, ...SHORTHAND_KEYS]);
    _allPropNames = [...s];
  }
  return _allPropNames;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

/** Find up to 3 closest property names within edit distance threshold. */
function suggestProperties(unknown: string): string[] {
  const lower = unknown.toLowerCase();
  const threshold = lower.length <= 3 ? 1 : lower.length <= 6 ? 2 : 3;
  const candidates: { name: string; dist: number }[] = [];

  for (const name of getAllPropNames()) {
    // Prefix match (e.g. "pad" → "padding")
    if (name.startsWith(lower) && name !== lower) {
      candidates.push({ name, dist: 0 });
      continue;
    }
    const dist = levenshtein(lower, name.toLowerCase());
    if (dist <= threshold) candidates.push({ name, dist });
  }

  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.slice(0, 3).map(c => c.name);
}

export interface NormalizePropsOptions {
  nodeType?: string;
  isCreate?: boolean;
}

/**
 * Normalize and validate properties for a specific node context.
 *
 * Pipeline:
 *   1. expandShorthands() — context-free property translation (single source of truth)
 *   2. textAutoResize sync — text node sizing (needs nodeType)
 *   3. LINE height restriction — (needs nodeType)
 *   4. Enum validation via PROP_METADATA — drop invalid enum values
 *   5. Node-type property filter — drop text-only props from non-text nodes
 *   6. Unknown property filter — drop anything not in capability manifest
 *
 * Note: align-requires-layoutMode is now handled by propertyDependencies.ts
 * (auto-injects layoutMode instead of deleting align — better behavior).
 */
export function normalizeProps(
  props: Record<string, any>,
  options: NormalizePropsOptions = {},
  warn: (msg: string) => void = () => {},
): Record<string, any> {
  // ── Step 1: Expand shorthands (context-free) ──
  const result = expandShorthands({ ...props });
  const isTextNode = options.nodeType?.toUpperCase() === 'TEXT';

  // ── Step 2: textAutoResize sync for text nodes ──
  // Invariant: any "lock width/height" intent → textAutoResize must reflect it.
  // After expandShorthands: w:280→{width:280}, w:fill→{layoutSizingH:'FILL'}, w:hug→{layoutSizingH:'HUG'}
  if (isTextNode && !result.textAutoResize) {
    const widthLocked =
      result.layoutSizingHorizontal === 'FILL' ||
      result.layoutSizingHorizontal === 'FIXED' ||
      typeof result.width === 'number';
    const heightLocked =
      result.layoutSizingVertical === 'FILL' ||
      result.layoutSizingVertical === 'FIXED' ||
      typeof result.height === 'number';

    if (widthLocked && heightLocked) {
      result.textAutoResize = 'NONE';
    } else if (widthLocked) {
      result.textAutoResize = 'HEIGHT';
    } else if (options.isCreate) {
      result.textAutoResize = 'WIDTH_AND_HEIGHT';
    }
  }

  // ── Step 2b: Convert auto-layout alignment to text alignment for text nodes ──
  if (isTextNode) {
    if (result.primaryAxisAlignItems && !result.textAlignHorizontal) {
      const alignMap: Record<string, string> = { MIN: 'LEFT', CENTER: 'CENTER', MAX: 'RIGHT' };
      const mapped = alignMap[result.primaryAxisAlignItems];
      if (mapped) result.textAlignHorizontal = mapped;
      delete result.primaryAxisAlignItems;
    }
    if (result.counterAxisAlignItems && !result.textAlignVertical) {
      const alignMap: Record<string, string> = { MIN: 'TOP', CENTER: 'CENTER', MAX: 'BOTTOM' };
      const mapped = alignMap[result.counterAxisAlignItems];
      if (mapped) result.textAlignVertical = mapped;
      delete result.counterAxisAlignItems;
    }
  }

  // ── Step 3: LINE nodes — height is strokeWeight, not dimensions ──
  if (options.nodeType?.toUpperCase() === 'LINE' && 'height' in result) {
    warn(`LINE nodes don't support height — visual thickness comes from strokeWeight. Prop ignored.`);
    delete result.height;
  }

  // ── Step 4: Boolean layout props — string → boolean ──
  for (const boolProp of ['clipsContent', 'strokesIncludedInLayout', 'itemReverseZIndex', 'constrainProportions'] as const) {
    if (boolProp in result && typeof result[boolProp] !== 'boolean') {
      const v = String(result[boolProp]).toLowerCase();
      result[boolProp] = (v === 'true' || v === 'hidden' || v === 'clip');
    }
  }

  // ── Step 5: Catch-all enum validation via PROP_METADATA ──
  for (const [prop, meta] of Object.entries(PROP_METADATA)) {
    if (meta.type !== 'enum' || !meta.enumMap || result[prop] === undefined) continue;
    if (typeof result[prop] === 'boolean') continue;
    const rawValue = String(result[prop]);
    const upper = rawValue.toUpperCase();
    let mapped = meta.enumMap[upper];
    if (!mapped) {
      const n = norm(rawValue);
      for (const [key, val] of Object.entries(meta.enumMap)) {
        if (norm(key) === n) { mapped = val; break; }
      }
    }
    if (mapped) {
      result[prop] = mapped;
    } else {
      const validValues = Object.keys(meta.enumMap).join(', ');
      warn(`${prop}:'${rawValue}' is not a valid Figma value. Valid: ${validValues}. Dropped.`);
      delete result[prop];
    }
  }

  // ── Step 6: Node-type property filter ──
  if (options.nodeType && !isTextNode) {
    for (const key of Object.keys(result)) {
      if (TEXT_ONLY_PROPS.has(key)) {
        warn(`${key} is a text-only property — dropped from ${options.nodeType}`);
        delete result[key];
      }
    }
  }

  // ── Step 7: Unknown property filter (with suggestions) ──
  for (const key of Object.keys(result)) {
    if (!KNOWN_PROP_KEYS.has(key)) {
      const suggestions = suggestProperties(key);
      const hint = suggestions.length > 0
        ? ` Did you mean: ${suggestions.join(', ')}?`
        : ' Run `man properties` for full property reference.';
      warn(`'${key}' is not a recognized property — dropped.${hint}`);
      delete result[key];
    }
  }

  return result;
}
