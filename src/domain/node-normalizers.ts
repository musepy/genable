/**
 * @file node-normalizers.ts
 * @description Cross-property rewrite rules that transform CSS-semantic
 * attributes into Figma-native canonical properties.
 *
 * Each normalizer is a pure function: (rawAttrs) → Partial<CanonicalProps>
 * They handle properties that cannot be mapped 1:1 (value depends on
 * other properties or requires splitting/merging).
 *
 * Replaces the logic from cssCompiler.ts.
 */

import { PROP_METADATA } from '../constants/figma-api';

// ── Normalize helper: strip hyphens/underscores + lowercase ──
const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, '');

// ── Value maps ──

const LAYOUT_VALUES: Record<string, string> = {
  row: 'HORIZONTAL',
  column: 'VERTICAL',
  none: 'NONE',
};

const JUSTIFY_VALUES: Record<string, string> = {
  center: 'CENTER',
  flexstart: 'MIN',
  start: 'MIN',
  flexend: 'MAX',
  end: 'MAX',
  spacebetween: 'SPACE_BETWEEN',
};

const ALIGN_VALUES: Record<string, string> = {
  center: 'CENTER',
  flexstart: 'MIN',
  start: 'MIN',
  flexend: 'MAX',
  end: 'MAX',
  baseline: 'BASELINE',
};

const NAME_ALIASES: Record<string, string> = {
  gap: 'itemSpacing',
  borderRadius: 'cornerRadius',
};

export interface NormalizePropsOptions {
  nodeType?: string;
}

/**
 * Apply all cross-property normalizations to a raw attribute map.
 * Returns a new object — does not mutate input.
 *
 * Rules applied (in order):
 *   1. layout → layoutMode (with value mapping)
 *   2. justifyContent → primaryAxisAlignItems
 *   3. alignItems → counterAxisAlignItems
 *   4. width/height: "fill"/"hug"/"100%" → layoutSizing*
 *   5. background → fills
 *   6. Name aliases (gap→itemSpacing, borderRadius→cornerRadius)
 *   7. clipsContent string → boolean
 *   8. layoutWrap string → Figma enum
 *   9. Catch-all enum normalization via PROP_METADATA
 */
export function normalizeProps(
  props: Record<string, any>,
  options: NormalizePropsOptions = {},
): Record<string, any> {
  const result: Record<string, any> = { ...props };
  const isTextNode = options.nodeType?.toUpperCase() === 'TEXT';

  // ── layout → layoutMode ──
  if ('layout' in result) {
    const raw = norm(String(result.layout));
    result.layoutMode = LAYOUT_VALUES[raw] ?? result.layout;
    delete result.layout;
  }

  // ── justifyContent → primaryAxisAlignItems ──
  if ('justifyContent' in result) {
    const raw = norm(String(result.justifyContent));
    result.primaryAxisAlignItems = JUSTIFY_VALUES[raw] ?? result.justifyContent;
    delete result.justifyContent;
  }

  // ── alignItems → counterAxisAlignItems ──
  if ('alignItems' in result) {
    const raw = norm(String(result.alignItems));
    result.counterAxisAlignItems = ALIGN_VALUES[raw] ?? result.alignItems;
    delete result.alignItems;
  }

  // ── width: "fill"/"hug"/"100%" → layoutSizingHorizontal ──
  if (!isTextNode && 'width' in result && typeof result.width === 'string') {
    const w = result.width.toLowerCase().trim();
    if (w === 'fill' || w === 'hug') {
      result.layoutSizingHorizontal = w.toUpperCase();
      delete result.width;
    } else if (w === '100%') {
      result.layoutSizingHorizontal = 'FILL';
      delete result.width;
    }
  }

  // ── height: "fill"/"hug"/"100%" → layoutSizingVertical ──
  if (!isTextNode && 'height' in result && typeof result.height === 'string') {
    const h = result.height.toLowerCase().trim();
    if (h === 'fill' || h === 'hug') {
      result.layoutSizingVertical = h.toUpperCase();
      delete result.height;
    } else if (h === '100%') {
      result.layoutSizingVertical = 'FILL';
      delete result.height;
    }
  }

  // ── background → fills ──
  if ('background' in result) {
    const bg = result.background;
    if (bg === 'transparent' || bg === 'none') {
      result.fills = [];
    } else if (typeof bg === 'string') {
      result.fills = [bg];
    } else if (Array.isArray(bg)) {
      result.fills = bg;
    } else {
      result.fills = bg;
    }
    delete result.background;
  }

  // ── Simple name aliases ──
  for (const [alias, canonical] of Object.entries(NAME_ALIASES)) {
    if (alias in result) {
      result[canonical] = result[alias];
      delete result[alias];
    }
  }

  // ── clipsContent string → boolean ──
  if ('clipsContent' in result && typeof result.clipsContent === 'string') {
    const v = String(result.clipsContent).toLowerCase();
    result.clipsContent = (v === 'hidden' || v === 'clip' || v === 'true');
  }

  // ── layoutWrap → Figma enum ──
  if ('layoutWrap' in result) {
    const v = String(result.layoutWrap).toLowerCase();
    if (v === 'wrap') result.layoutWrap = 'WRAP';
    else if (v === 'nowrap' || v === 'no-wrap') result.layoutWrap = 'NO_WRAP';
  }

  // ── Catch-all enum normalization ──
  for (const [prop, meta] of Object.entries(PROP_METADATA)) {
    if (meta.type !== 'enum' || !meta.enumMap || result[prop] === undefined) continue;
    // Skip clipsContent — it's already been converted to boolean above
    if (prop === 'clipsContent' && typeof result[prop] === 'boolean') continue;
    const upper = String(result[prop]).toUpperCase();
    let mapped = meta.enumMap[upper];
    if (!mapped) {
      const n = norm(String(result[prop]));
      for (const [key, val] of Object.entries(meta.enumMap)) {
        if (norm(key) === n) { mapped = val; break; }
      }
    }
    if (mapped) {
      result[prop] = mapped;
    }
  }

  return result;
}
