/**
 * @file expandShorthands.ts
 * @description Property shorthand expansion — translates high-level design intent
 * into canonical Figma property names and values.
 *
 * LLM writes simplified props → this layer expands to Figma API props.
 * Runs in the executor before validateDependencies and property handlers.
 *
 * Design: explicit Figma-native props always override shorthand expansion.
 * Multiple effect shorthands (shadow + blur) are merged, not overwritten.
 */

import { effectSpec } from '../../domain/property-specs';

// ─── Value Maps ──────────────────────────────────────────────────────────────

const LAYOUT_MAP: Record<string, string> = {
  row: 'HORIZONTAL', column: 'VERTICAL', horizontal: 'HORIZONTAL',
  vertical: 'VERTICAL', none: 'NONE',
};

const ALIGN_MAP: Record<string, string> = {
  center: 'CENTER', start: 'MIN', end: 'MAX',
  flexstart: 'MIN', flexend: 'MAX',
  spacebetween: 'SPACE_BETWEEN', baseline: 'BASELINE',
};

const PATTERNS: Record<string, Record<string, any>> = {
  'row':         { layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG', fills: [] },
  'column':      { layoutMode: 'VERTICAL',   layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG', fills: [] },
  'row-fill':    { layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG', fills: [] },
  'column-fill': { layoutMode: 'VERTICAL',   layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'FILL', fills: [] },
  'stack':       { layoutMode: 'NONE' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check if a value is a variable reference ($varName). Pass through as-is. */
const isVarRef = (v: any): v is string => typeof v === 'string' && v.startsWith('$');

const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, '');

function mapAlign(v: string): string {
  return ALIGN_MAP[norm(v)] ?? v.toUpperCase();
}

function expandPaddingParts(parts: number[]): Record<string, number> {
  switch (parts.length) {
    case 1:  return { paddingTop: parts[0], paddingRight: parts[0], paddingBottom: parts[0], paddingLeft: parts[0] };
    case 2:  return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[0], paddingLeft: parts[1] };
    case 3:  return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[2], paddingLeft: parts[1] };
    default: return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[2], paddingLeft: parts[3] };
  }
}

// ─── Expanders ───────────────────────────────────────────────────────────────
// Each expander: (value, allProps) → Record<string, any> of canonical Figma props.

type Expander = (value: any, allProps: Record<string, any>) => Record<string, any>;

/** Effect-related keys — handled in pre-pass to merge arrays */
const EFFECT_KEYS = new Set(['shadow', 'blur', 'bgblur']);

const EXPANDERS: Record<string, Expander> = {

  // ── Layout ─────────────────────────────────────────────────────────────
  layout: (v) => ({
    layoutMode: LAYOUT_MAP[norm(String(v))] ?? String(v).toUpperCase(),
  }),

  pattern: (v, all) => {
    const pat = PATTERNS[String(v).toLowerCase()];
    if (!pat) return {};
    const result = { ...pat };
    // Don't override explicit fill
    if ('fill' in all || 'fills' in all || 'background' in all || 'bg' in all) {
      delete result.fills;
    }
    return result;
  },

  // ── Alignment ──────────────────────────────────────────────────────────
  align: (v) => {
    const parts = String(v).trim().split(/\s+/);
    if (parts.length === 1) {
      const m = mapAlign(parts[0]);
      return { primaryAxisAlignItems: m, counterAxisAlignItems: m };
    }
    return { primaryAxisAlignItems: mapAlign(parts[0]), counterAxisAlignItems: mapAlign(parts[1]) };
  },

  justifyContent: (v) => ({ primaryAxisAlignItems: mapAlign(String(v)) }),
  alignItems: (v) => ({ counterAxisAlignItems: mapAlign(String(v)) }),

  // ── Spacing ────────────────────────────────────────────────────────────
  padding: (v) => {
    if (isVarRef(v)) return { paddingTop: v, paddingRight: v, paddingBottom: v, paddingLeft: v };
    if (typeof v === 'number') return expandPaddingParts([v]);
    if (typeof v === 'string') return expandPaddingParts(v.trim().split(/[\s,]+/).map(Number));
    if (Array.isArray(v)) return expandPaddingParts(v.map(Number));
    return {};
  },

  gap: (v) => isVarRef(v) ? { itemSpacing: v } : { itemSpacing: Number(v) },
  crossGap: (v) => isVarRef(v) ? { counterAxisSpacing: v } : { counterAxisSpacing: Number(v) },
  crossAxisGap: (v) => isVarRef(v) ? { counterAxisSpacing: v } : { counterAxisSpacing: Number(v) },

  // ── Sizing ─────────────────────────────────────────────────────────────
  width: (v) => {
    if (typeof v === 'string') {
      const w = v.toLowerCase().trim();
      if (w === 'fill' || w === '100%') return { layoutSizingHorizontal: 'FILL' };
      if (w === 'hug') return { layoutSizingHorizontal: 'HUG' };
    }
    return { width: v };
  },

  height: (v) => {
    if (typeof v === 'string') {
      const h = v.toLowerCase().trim();
      if (h === 'fill' || h === '100%') return { layoutSizingVertical: 'FILL' };
      if (h === 'hug') return { layoutSizingVertical: 'HUG' };
    }
    return { height: v };
  },

  sizing: (v) => {
    if (typeof v === 'string') {
      const s = v.toUpperCase();
      return { layoutSizingHorizontal: s, layoutSizingVertical: s };
    }
    if (Array.isArray(v) && v.length === 2) {
      return { layoutSizingHorizontal: String(v[0]).toUpperCase(), layoutSizingVertical: String(v[1]).toUpperCase() };
    }
    return {};
  },

  // ── Paint ──────────────────────────────────────────────────────────────
  fill: (v) => {
    if (isVarRef(v)) return { fills: v }; // $varName → handler binds color variable
    if (v === 'transparent' || v === 'none') return { fills: [] };
    if (typeof v === 'string') return { fills: [v] };
    if (Array.isArray(v)) return { fills: v };
    return { fills: v };
  },

  background: (v) => EXPANDERS.fill(v, {}),
  bg: (v) => EXPANDERS.fill(v, {}),

  stroke: (v) => {
    if (typeof v === 'string') {
      const result: Record<string, any> = {};
      for (const p of v.trim().split(/\s+/)) {
        if (p.startsWith('#')) result.strokes = [p];
        else if (/^\d/.test(p)) result.strokeWeight = parseFloat(p);
        else result.strokeAlign = p.toUpperCase();
      }
      return result;
    }
    return {};
  },

  // ── Effects (merged in pre-pass) ───────────────────────────────────────
  shadow: (v) => {
    if (typeof v === 'string') return { effects: effectSpec.parseXml(v) };
    if (Array.isArray(v)) return { effects: v };
    return {};
  },

  blur: (v) => ({ effects: [{ kind: 'blur' as const, type: 'layer', radius: Number(v) }] }),
  bgblur: (v) => ({ effects: [{ kind: 'blur' as const, type: 'background', radius: Number(v) }] }),

  // ── Shape ──────────────────────────────────────────────────────────────
  radius: (v) => {
    if (isVarRef(v)) return { cornerRadius: v };
    if (Array.isArray(v) && v.length === 4) {
      return { topLeftRadius: v[0], topRightRadius: v[1], bottomLeftRadius: v[2], bottomRightRadius: v[3] };
    }
    // 'full' = fully rounded (circle for square nodes) — Figma clamps to half the shorter side
    if (String(v).toLowerCase() === 'full') return { cornerRadius: 9999 };
    return { cornerRadius: Number(v) };
  },

  corner: (v) => EXPANDERS.radius(v, {}),

  // ── Layout details ─────────────────────────────────────────────────────
  smooth: (v) => ({ cornerSmoothing: v }),
  blend: (v) => ({ blendMode: v }),
  borderRadius: (v) => ({ cornerRadius: v }),

  overflow: (v) => {
    const s = String(v).toLowerCase();
    return { clipsContent: s === 'true' || s === 'hidden' || s === 'clip' };
  },

  wrap: (v) => {
    const s = String(v).toLowerCase();
    if (s === 'wrap') return { layoutWrap: 'WRAP' };
    if (s === 'nowrap' || s === 'no-wrap') return { layoutWrap: 'NO_WRAP' };
    return { layoutWrap: String(v).toUpperCase() };
  },

  // ── DSL abbreviations (text compression aliases) ───────────────────────
  // These delegate to semantic expanders above so DSL parser can skip
  // ABBREV_EXPANSION and pass raw keys directly.
  w: (v, all) => EXPANDERS.width(v, all),
  h: (v, all) => EXPANDERS.height(v, all),
  p: (v, all) => EXPANDERS.padding(v, all),
  pt: (v) => ({ paddingTop: isVarRef(v) ? v : Number(v) }),
  pr: (v) => ({ paddingRight: isVarRef(v) ? v : Number(v) }),
  pb: (v) => ({ paddingBottom: isVarRef(v) ? v : Number(v) }),
  pl: (v) => ({ paddingLeft: isVarRef(v) ? v : Number(v) }),
  size: (v) => ({ fontSize: isVarRef(v) ? v : Number(v) }),
  weight: (v) => {
    // Support hyphenated aliases: semi-bold → Semi Bold, extra-bold → Extra Bold
    const s = String(v);
    const WEIGHT_ALIASES: Record<string, string> = {
      thin: 'Thin', extralight: 'Extra Light', light: 'Light',
      regular: 'Regular', medium: 'Medium', semibold: 'Semi Bold',
      bold: 'Bold', extrabold: 'Extra Bold', black: 'Black',
    };
    const normalized = s.toLowerCase().replace(/[-_\s]/g, '');
    return { fontWeight: WEIGHT_ALIASES[normalized] ?? s };
  },
  font: (v) => ({ fontFamily: String(v) }),
  alignMain: (v) => ({ primaryAxisAlignItems: mapAlign(String(v)) }),
  alignCross: (v) => ({ counterAxisAlignItems: mapAlign(String(v)) }),
  textAlign: (v) => ({ textAlignHorizontal: String(v).toUpperCase() }),
  positioning: (v) => ({ layoutPositioning: String(v).toUpperCase() }),
  tracking: (v) => ({ letterSpacing: v }),
  // CSS multiplier detection: 1.5 = 150%, not 1.5px
  // Values ≤ 5 are almost certainly multipliers, not pixel heights
  lineHeight: (v) => {
    const n = Number(v);
    if (!isNaN(n) && n > 0 && n <= 5) return { lineHeight: `${Math.round(n * 100)}%` };
    return { lineHeight: v };
  },
  leading: (v, all) => EXPANDERS.lineHeight(v, all),
  strokeW: (v) => ({ strokeWeight: isVarRef(v) ? v : Number(v) }),
  strokeA: (v) => ({ strokeAlign: String(v).toUpperCase() }),
  strokeJ: (v) => ({ strokeJoin: String(v).toUpperCase() }),
  strokeC: (v) => ({ strokeCap: String(v).toUpperCase() }),
  dash: (v) => ({ dashPattern: v }),
  strokeT: (v) => ({ strokeTopWeight: Number(v) }),
  strokeR: (v) => ({ strokeRightWeight: Number(v) }),
  strokeB: (v) => ({ strokeBottomWeight: Number(v) }),
  strokeL: (v) => ({ strokeLeftWeight: Number(v) }),
  sizingH: (v) => ({ layoutSizingHorizontal: String(v).toUpperCase() }),
  sizingV: (v) => ({ layoutSizingVertical: String(v).toUpperCase() }),
  strokesInLayout: (v) => ({ strokesIncludedInLayout: v === true || String(v).toLowerCase() === 'true' }),
  reverseZ: (v) => ({ itemReverseZIndex: v === true || String(v).toLowerCase() === 'true' }),
  lockRatio: (v) => ({ constrainProportions: v === true || String(v).toLowerCase() === 'true' }),
  pin: (v) => ({ constraints: v }),
  minW: (v) => ({ minWidth: isVarRef(v) ? v : Number(v) }),
  maxW: (v) => ({ maxWidth: isVarRef(v) ? v : Number(v) }),
  minH: (v) => ({ minHeight: isVarRef(v) ? v : Number(v) }),
  maxH: (v) => ({ maxHeight: isVarRef(v) ? v : Number(v) }),
};

/** All shorthand keys recognized by the expander — exported for suggestion matching. */
export const SHORTHAND_KEYS: ReadonlySet<string> = new Set(Object.keys(EXPANDERS));

// ─── Text Content Normalization ──────────────────────────────────────────────

/** CSS text-transform prefixes that LLMs write as literal text content */
const TEXT_TRANSFORM_PREFIXES: Record<string, string> = {
  'uppercase ': 'UPPER',
  'lowercase ': 'LOWER',
  'capitalize ': 'TITLE',
};

/**
 * Detect "uppercase X" in characters → strip prefix, set textCase.
 * LLMs confuse CSS text-transform with literal text content.
 */
function normalizeTextContent(props: Record<string, any>): void {
  if (typeof props.characters !== 'string') return;
  for (const [prefix, textCase] of Object.entries(TEXT_TRANSFORM_PREFIXES)) {
    if (props.characters.toLowerCase().startsWith(prefix)) {
      props.characters = props.characters.substring(prefix.length);
      if (!props.textCase) props.textCase = textCase;
      break;
    }
  }
}

// ─── Main Function ───────────────────────────────────────────────────────────

/**
 * Expand shorthand property names and values into canonical Figma properties.
 *
 * Rules:
 * - Explicit Figma-native props always override shorthand expansions
 * - Multiple effect shorthands (shadow + blur) are merged into one effects array
 * - "uppercase X" in characters → textCase: UPPER + strip prefix
 * - Unknown props pass through unchanged
 */
export function expandShorthands(props: Record<string, any>): Record<string, any> {
  const expanded: Record<string, any> = {};
  const passthrough: Record<string, any> = {};

  // Pre-pass: merge all effect shorthands into a single effects array
  const mergedEffects: any[] = [];
  for (const ek of EFFECT_KEYS) {
    if (ek in props) {
      const result = EXPANDERS[ek]!(props[ek], props);
      if (result.effects) mergedEffects.push(...result.effects);
    }
  }
  if (mergedEffects.length > 0) {
    expanded.effects = mergedEffects;
  }

  // Main pass: expand all other shorthands
  for (const [key, value] of Object.entries(props)) {
    if (EFFECT_KEYS.has(key)) continue; // already handled

    const expander = EXPANDERS[key];
    if (expander) {
      Object.assign(expanded, expander(value, props));
    } else {
      passthrough[key] = value;
    }
  }

  // Passthrough (explicit Figma-native props) overrides expanded shorthands
  const result = { ...expanded, ...passthrough };

  // Post-pass: normalize text content ("uppercase X" → textCase + strip)
  normalizeTextContent(result);

  return result;
}
