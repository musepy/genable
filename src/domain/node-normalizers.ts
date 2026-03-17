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
import { expandShorthands } from '../engine/actions/expandShorthands';

const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, '');

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
  if (isTextNode && !result.textAutoResize) {
    const hasSizingChange = result.layoutSizingHorizontal !== undefined || result.layoutSizingVertical !== undefined;
    if (options.isCreate || hasSizingChange) {
      if (result.layoutSizingHorizontal === 'FILL') {
        result.textAutoResize = 'HEIGHT';
      } else {
        result.textAutoResize = 'WIDTH_AND_HEIGHT';
      }
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

  // ── Step 7: Unknown property filter ──
  for (const key of Object.keys(result)) {
    if (!KNOWN_PROP_KEYS.has(key)) {
      warn(`'${key}' is not a supported property — dropped`);
      delete result[key];
    }
  }

  return result;
}
