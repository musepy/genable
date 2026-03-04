/**
 * @file cssCompiler.ts
 * @description Compiles CSS-semantic properties (written by LLM) to Figma-native properties.
 *
 * LLM writes CSS-like props (layout, justifyContent, alignItems, gap, background, etc.)
 * and this compiler translates them to Figma-native equivalents before execution.
 * Figma-native property names are still accepted (pass-through).
 *
 * Also normalizes ALL enum values via PROP_METADATA as a final catch-all,
 * so that any casing variant (center, CENTER, Center) is accepted.
 */

import { PROP_METADATA } from '../../constants/figma-api';

// ── Normalize: strip hyphens/underscores + lowercase ──
// So "space-between", "spaceBetween", "SPACE_BETWEEN" all → "spacebetween"
const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, '');

// ── Value maps (keys are normalized) ──

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

// ── Simple name aliases (no value transform needed) ──

const NAME_ALIASES: Record<string, string> = {
  gap: 'itemSpacing',
  borderRadius: 'cornerRadius',
};

/**
 * Compile CSS-semantic properties to Figma-native properties.
 *
 * Rules:
 * 1. CSS names take priority over Figma names when both are present.
 * 2. All unrecognized properties pass through unchanged.
 * 3. `width/height: "fill"/"hug"` → layoutSizing + delete width/height.
 * 4. `background: string` → `fills: [string]` (wrap single value).
 */
export function compileCssProps(props: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};

  // First pass: copy everything except CSS-semantic keys we'll transform
  for (const [key, value] of Object.entries(props)) {
    result[key] = value;
  }

  // ── layout → layoutMode (with value mapping) ──
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

  // ── width: "fill"/"hug" → layoutSizingHorizontal ──
  if ('width' in result && typeof result.width === 'string') {
    const w = result.width.toLowerCase();
    if (w === 'fill' || w === 'hug') {
      result.layoutSizingHorizontal = w.toUpperCase();
      delete result.width;
    }
    // else: non-numeric string left as-is (pass-through for edge cases)
  }

  // ── height: "fill"/"hug" → layoutSizingVertical ──
  if ('height' in result && typeof result.height === 'string') {
    const h = result.height.toLowerCase();
    if (h === 'fill' || h === 'hug') {
      result.layoutSizingVertical = h.toUpperCase();
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
      result.fills = bg; // pass-through objects (gradients etc.)
    }
    delete result.background;
  }

  // ── Simple name aliases (gap→itemSpacing, borderRadius→cornerRadius) ──
  for (const [alias, canonical] of Object.entries(NAME_ALIASES)) {
    if (alias in result) {
      // CSS name takes priority: overwrite canonical if both exist
      result[canonical] = result[alias];
      delete result[alias];
    }
  }

  // ── Catch-all: normalize ALL enum values via PROP_METADATA ──
  // Handles textAlignHorizontal, strokeAlign, textAutoResize, etc.
  // that don't have explicit CSS→Figma mappings above.
  for (const [prop, meta] of Object.entries(PROP_METADATA)) {
    if (meta.type !== 'enum' || !meta.enumMap || result[prop] === undefined) continue;
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
    // If still not matched, leave as-is for downstream error reporting
  }

  return result;
}
