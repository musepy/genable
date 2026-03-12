/**
 * @file node-normalizers.ts
 * @description Cross-property rewrite rules that transform CSS-semantic
 * attributes into Figma-native canonical properties.
 *
 * Responsibilities split:
 *   - CSS alias blocks: rename properties (alignItems → counterAxisAlignItems)
 *     and translate known CSS values (flex-start → MIN). Unknown values pass through.
 *   - Catch-all enum normalizer: validates ALL enum values against PROP_METADATA.
 *     Unknown values are dropped with a warning — never passed to Figma.
 *
 * Replaces the logic from cssCompiler.ts.
 */

import { PROP_METADATA, TEXT_ONLY_PROPS, KNOWN_PROP_KEYS } from '../constants/figma-api';

// ── Normalize helper: strip hyphens/underscores + lowercase ──
const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, '');

// ── CSS → Figma value maps (conceptual translation, not just casing) ──

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

// ── Layout patterns — semantic shortcuts that set structural defaults ──
// Pattern defaults are overridable: explicit props always win.
// bg:transparent is skipped if an explicit fill was already set.
//
// Usage: frame(parent, {pattern:'row', gap:8, p:16})
//   → layout:'row', width:'hug', height:'hug', bg:transparent + explicit gap/padding
const LAYOUT_PATTERNS: Record<string, Record<string, string>> = {
  'row':         { layout: 'row',    width: 'hug',  height: 'hug',  background: 'transparent' },
  'column':      { layout: 'column', width: 'hug',  height: 'hug',  background: 'transparent' },
  'row-fill':    { layout: 'row',    width: 'fill', height: 'hug',  background: 'transparent' },
  'column-fill': { layout: 'column', width: 'hug',  height: 'fill', background: 'transparent' },
  'stack':       { layout: 'none' },
};

export interface NormalizePropsOptions {
  nodeType?: string;
  isCreate?: boolean;
}

/**
 * Apply all cross-property normalizations to a raw attribute map.
 * Returns a new object — does not mutate input.
 *
 * Rules applied (in order):
 *   0. pattern → expand layout/sizing/bg defaults (explicit props override)
 *   1. layout → layoutMode (with value mapping)
 *   2. justifyContent → primaryAxisAlignItems
 *   3. alignItems → counterAxisAlignItems
 *   4. width/height: "fill"/"hug"/"100%" → layoutSizing*
 *   5. background → fills
 *   6. Name aliases (gap→itemSpacing, borderRadius→cornerRadius)
 *   7. clipsContent string → boolean
 *   8. layoutWrap string → Figma enum
 *   9. Catch-all enum validation via PROP_METADATA (drop unknown values)
 */
export function normalizeProps(
  props: Record<string, any>,
  options: NormalizePropsOptions = {},
  warn: (msg: string) => void = () => {},
): Record<string, any> {
  const result: Record<string, any> = { ...props };
  const isTextNode = options.nodeType?.toUpperCase() === 'TEXT';

  // ── Step 0: pattern expansion — sets structural defaults, explicit props win ──
  if ('pattern' in result) {
    const expansion = LAYOUT_PATTERNS[String(result.pattern).toLowerCase()];
    if (expansion) {
      // On update: skip bg default (never reset an existing node's fill)
      // On create: skip bg default only if LLM already set an explicit fill
      const skipBg = !options.isCreate || 'fills' in result || 'fill' in result;
      for (const [k, v] of Object.entries(expansion)) {
        if (k === 'background' && skipBg) continue;
        if (!(k in result)) result[k] = v;
      }
    } else {
      warn(`pattern:'${result.pattern}' is not recognized. Valid: ${Object.keys(LAYOUT_PATTERNS).join(', ')}.`);
    }
    delete result.pattern;
  }

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
  if ('width' in result && typeof result.width === 'string') {
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
  if ('height' in result && typeof result.height === 'string') {
    const h = result.height.toLowerCase().trim();
    if (h === 'fill' || h === 'hug') {
      result.layoutSizingVertical = h.toUpperCase();
      delete result.height;
    } else if (h === '100%') {
      result.layoutSizingVertical = 'FILL';
      delete result.height;
    }
  }

  // ── Auto-fill textAutoResize for text creates ──
  if (isTextNode && options.isCreate && !result.textAutoResize) {
    // Text with FILL sizing will wrap — use HEIGHT; otherwise hug to content
    if (result.layoutSizingHorizontal === 'FILL') {
      result.textAutoResize = 'HEIGHT';
    } else {
      result.textAutoResize = 'WIDTH_AND_HEIGHT';
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

  // ── Boolean layout props: string → boolean ──
  for (const boolProp of ['clipsContent', 'strokesIncludedInLayout', 'itemReverseZIndex', 'constrainProportions'] as const) {
    if (boolProp in result && typeof result[boolProp] !== 'boolean') {
      const v = String(result[boolProp]).toLowerCase();
      result[boolProp] = (v === 'true' || v === 'hidden' || v === 'clip');
    }
  }

  // ── layoutWrap → Figma enum ──
  if ('layoutWrap' in result) {
    const v = String(result.layoutWrap).toLowerCase();
    if (v === 'wrap') result.layoutWrap = 'WRAP';
    else if (v === 'nowrap' || v === 'no-wrap') result.layoutWrap = 'NO_WRAP';
  }

  // ── Cross-property validation: align requires layoutMode ──
  // primaryAxisAlignItems / counterAxisAlignItems are only meaningful when
  // layoutMode is HORIZONTAL or VERTICAL. On a plain frame they are silently
  // ignored by Figma, so we drop them early and surface a warning so the LLM
  // can self-correct by adding layout:'row'/'column'.
  if (options.isCreate) {
    const hasAlign = 'primaryAxisAlignItems' in result || 'counterAxisAlignItems' in result;
    const hasLayout = 'layoutMode' in result && result.layoutMode !== 'NONE';
    if (hasAlign && !hasLayout) {
      for (const prop of ['primaryAxisAlignItems', 'counterAxisAlignItems'] as const) {
        if (prop in result) {
          warn(`${prop} requires layout:'row' or layout:'column' — property ignored. Add layout to enable auto-layout.`);
          delete result[prop];
        }
      }
    }
  }

  // ── LINE nodes: height is always 0 — visual thickness comes from strokeWeight ──
  if (options.nodeType?.toUpperCase() === 'LINE' && 'height' in result) {
    warn(`LINE nodes don't support height — visual thickness comes from strokeWeight. Prop ignored.`);
    delete result.height;
  }

  // ── Catch-all enum validation via PROP_METADATA ──
  // Single authority for enum validity. Unknown values are dropped with a warning.
  for (const [prop, meta] of Object.entries(PROP_METADATA)) {
    if (meta.type !== 'enum' || !meta.enumMap || result[prop] === undefined) continue;
    // Skip boolean layout props — already converted above
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

  // ── Node-type property filter: drop text-only props from non-text nodes ──
  if (options.nodeType && !isTextNode) {
    for (const key of Object.keys(result)) {
      if (TEXT_ONLY_PROPS.has(key)) {
        warn(`${key} is a text-only property — dropped from ${options.nodeType}`);
        delete result[key];
      }
    }
  }

  // ── Unknown property filter: drop anything not in the capability manifest ──
  for (const key of Object.keys(result)) {
    if (!KNOWN_PROP_KEYS.has(key)) {
      warn(`'${key}' is not a supported property — dropped`);
      delete result[key];
    }
  }

  return result;
}
