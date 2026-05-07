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
import { parseHexToRGBA } from '../../utils/colorUtils';

// ─── Value Maps ──────────────────────────────────────────────────────────────

const LAYOUT_MAP: Record<string, string> = {
  row: 'HORIZONTAL', column: 'VERTICAL', horizontal: 'HORIZONTAL',
  vertical: 'VERTICAL', grid: 'GRID', none: 'NONE',
};

const GRID_ALIGN_MAP: Record<string, string> = {
  start: 'MIN', end: 'MAX', center: 'CENTER', auto: 'AUTO',
  min: 'MIN', max: 'MAX',
};

const ALIGN_MAP: Record<string, string> = {
  center: 'CENTER', start: 'MIN', end: 'MAX',
  flexstart: 'MIN', flexend: 'MAX',
  spacebetween: 'SPACE_BETWEEN', between: 'SPACE_BETWEEN',
  // Figma only has SPACE_BETWEEN — map CSS space-around/space-evenly to closest equivalent
  spacearound: 'SPACE_BETWEEN', around: 'SPACE_BETWEEN',
  spaceevenly: 'SPACE_BETWEEN', evenly: 'SPACE_BETWEEN',
  baseline: 'BASELINE',
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

// Fail-fast on unknown align values: white-list check + throw. Mirrors the
// layout fail-fast (commit 58656a4) — keeps LLM vocabulary tight, surfaces
// typos (`centre`, `middle`) as ToolResponse.error so the next iteration
// self-corrects. Do NOT add fuzzy matching or tolerant fallbacks.
//
// `space-around`/`space-evenly`/`around`/`evenly` approximate to SPACE_BETWEEN
// because Figma has no SPACE_AROUND — this is preserved as a deliberate
// best-effort mapping (not a silent drop; still in ALIGN_MAP above).
function mapAlign(v: string): string {
  const mapped = ALIGN_MAP[norm(String(v))];
  if (!mapped) {
    throw new Error(
      `unknown align "${v}"; valid: center|start|end|space-between|baseline`,
    );
  }
  return mapped;
}

function mapGridAlign(v: string): string {
  const mapped = GRID_ALIGN_MAP[norm(String(v))];
  if (!mapped) {
    throw new Error(
      `unknown align "${v}"; valid: start|end|center|min|max|auto`,
    );
  }
  return mapped;
}

function resolveLayoutMode(all: Record<string, any>): string | undefined {
  if (all.layoutMode === 'GRID') return 'GRID';
  if (all.cols !== undefined || all.rows !== undefined) return 'GRID';
  if (typeof all.layout === 'string') {
    return LAYOUT_MAP[norm(all.layout)];
  }
  return undefined;
}

/** Whitespace tokenizer that keeps parenthesized expressions whole — so
 *  `1.5 linear-gradient(90deg, #A 0%, #B 100%)` returns
 *  ["1.5", "linear-gradient(90deg, #A 0%, #B 100%)"] instead of breaking the
 *  gradient into 6 garbage tokens. Used by the stroke shorthand. */
function splitStrokeTokens(s: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  let depth = 0;
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth === 0 && /\s/.test(c)) {
      if (buf) { tokens.push(buf); buf = ''; }
    } else {
      buf += c;
    }
  }
  if (buf) tokens.push(buf);
  return tokens;
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
  // Narrow vocabulary + fail-fast: unknown values throw so the LLM sees
  // the error next iteration and self-corrects. Do NOT add fuzzy matching
  // or tolerant fallbacks — keeping vocabulary tight is the whole point.
  layout: (v) => {
    const key = norm(String(v));
    const mapped = LAYOUT_MAP[key];
    if (!mapped) {
      throw new Error(
        `unknown layout "${v}"; valid: row|column|horizontal|vertical|grid|none`,
      );
    }
    return { layoutMode: mapped };
  },

  pattern: (v, all) => {
    const pat = PATTERNS[String(v).toLowerCase()];
    if (!pat) return {};
    const result = { ...pat };
    // Don't override explicit fill
    if ('fill' in all || 'fills' in all || 'background' in all || 'bg' in all) {
      delete result.fills;
    }
    // Don't override explicit sizing — HUG defaults should yield to explicit w/h
    if ('w' in all || 'width' in all) {
      delete result.layoutSizingHorizontal;
    }
    if ('h' in all || 'height' in all) {
      delete result.layoutSizingVertical;
    }
    return result;
  },

  // ── Alignment ──────────────────────────────────────────────────────────
  align: (v) => {
    const parts = String(v).trim().split(/\s+/);
    if (parts.length === 1) {
      // Single value sets BOTH axes. LLMs write align="center" meaning
      // "center it", not CSS align-items cross-only semantics. Dropping CSS
      // parity here eliminates axis ambiguity (the injected layoutMode
      // direction no longer changes the visible result).
      // Use alignItems=/justifyContent= for explicit single-axis control.
      const mapped = mapAlign(parts[0]);
      return { primaryAxisAlignItems: mapped, counterAxisAlignItems: mapped };
    }
    return { primaryAxisAlignItems: mapAlign(parts[0]), counterAxisAlignItems: mapAlign(parts[1]) };
  },

  justifyContent: (v) => ({ primaryAxisAlignItems: mapAlign(String(v)) }),
  justify: (v) => ({ primaryAxisAlignItems: mapAlign(String(v)) }),
  alignItems: (v) => ({ counterAxisAlignItems: mapAlign(String(v)) }),
  // `items` — Tailwind-style cross-axis alignment (preferred canonical name).
  // Aliases: alignItems (CSS), alignCross (legacy read-side), align (two-axis shortcut).
  items: (v) => ({ counterAxisAlignItems: mapAlign(String(v)) }),

  // ── Spacing ────────────────────────────────────────────────────────────
  padding: (v) => {
    if (isVarRef(v)) return { paddingTop: v, paddingRight: v, paddingBottom: v, paddingLeft: v };
    if (typeof v === 'number') return expandPaddingParts([v]);
    if (typeof v === 'string') {
      const parts = v.trim().split(/[\s,]+/).map(Number);
      if (parts.some(isNaN)) return {};
      return expandPaddingParts(parts);
    }
    if (Array.isArray(v)) return expandPaddingParts(v.map(Number));
    // Object syntax: p={{top:12, bottom:12, left:16, right:16}} or {t:12, b:12, l:16, r:16}
    if (typeof v === 'object' && v !== null) {
      const result: Record<string, number | string> = {};
      const coerce = (x: any) => isVarRef(x) ? x : Number(x);
      if (v.top != null || v.t != null) result.paddingTop = coerce(v.top ?? v.t);
      if (v.right != null || v.r != null) result.paddingRight = coerce(v.right ?? v.r);
      if (v.bottom != null || v.b != null) result.paddingBottom = coerce(v.bottom ?? v.b);
      if (v.left != null || v.l != null) result.paddingLeft = coerce(v.left ?? v.l);
      return result as Record<string, number>;
    }
    return {};
  },

  gap: (v, all) => {
    const val = isVarRef(v) ? v : Number(v);
    // GRID uses gridRowGap/gridColumnGap, not itemSpacing.
    if (resolveLayoutMode(all) === 'GRID') {
      return { gridRowGap: val, gridColumnGap: val };
    }
    return { itemSpacing: val };
  },
  crossGap: (v) => isVarRef(v) ? { counterAxisSpacing: v } : { counterAxisSpacing: Number(v) },
  crossAxisGap: (v) => isVarRef(v) ? { counterAxisSpacing: v } : { counterAxisSpacing: Number(v) },

  // ── Grid container (layoutMode=GRID) ──────────────────────────────────
  cols: (v) => ({ gridColumnCount: Number(v) }),
  rows: (v) => ({ gridRowCount: Number(v) }),
  rowGap: (v) => ({ gridRowGap: isVarRef(v) ? v : Number(v) }),
  colGap: (v) => ({ gridColumnGap: isVarRef(v) ? v : Number(v) }),
  columnGap: (v) => ({ gridColumnGap: isVarRef(v) ? v : Number(v) }),

  // ── Grid child (parent layoutMode=GRID) ───────────────────────────────
  rowSpan: (v) => ({ gridRowSpan: Number(v) }),
  colSpan: (v) => ({ gridColumnSpan: Number(v) }),
  columnSpan: (v) => ({ gridColumnSpan: Number(v) }),
  alignX: (v) => ({ gridChildHorizontalAlign: mapGridAlign(String(v)) }),
  alignY: (v) => ({ gridChildVerticalAlign: mapGridAlign(String(v)) }),

  // ── Sizing ─────────────────────────────────────────────────────────────
  // Fail-fast on unknown sizing strings: only number | 'fill' | 'hug' | '100%'
  // pass. Mirrors layout/align fail-fast — typos like `w='filll'` surface as
  // ToolResponse.error for LLM self-correction. Non-string numeric JSX values
  // pass through unchanged (e.g. `w={240}`).
  width: (v) => {
    if (typeof v === 'number') return { width: v };
    if (typeof v === 'string') {
      const w = v.toLowerCase().trim();
      if (w === 'fill' || w === '100%') return { layoutSizingHorizontal: 'FILL' };
      if (w === 'hug') return { layoutSizingHorizontal: 'HUG' };
      // Strip CSS units: "200px" → 200
      const parsed = parseFloat(w);
      if (!isNaN(parsed)) return { width: parsed };
      throw new Error(
        `unknown sizing value "${v}"; valid: number|fill|hug|100%`,
      );
    }
    return { width: v };
  },

  height: (v) => {
    if (typeof v === 'number') return { height: v };
    if (typeof v === 'string') {
      const h = v.toLowerCase().trim();
      if (h === 'fill' || h === '100%') return { layoutSizingVertical: 'FILL' };
      if (h === 'hug') return { layoutSizingVertical: 'HUG' };
      // Strip CSS units: "100px" → 100
      const parsed = parseFloat(h);
      if (!isNaN(parsed)) return { height: parsed };
      throw new Error(
        `unknown sizing value "${v}"; valid: number|fill|hug|100%`,
      );
    }
    return { height: v };
  },

  // ── Paint ──────────────────────────────────────────────────────────────
  fill: (v) => {
    if (isVarRef(v)) return { fills: v }; // $varName → handler binds color variable
    if (v === 'transparent' || v === 'none') return { fills: [] };
    if (typeof v === 'string') return { fills: [v] };
    if (Array.isArray(v)) return { fills: v };
    // Object: {color:"#FF0000", blendMode:"MULTIPLY"} → wrap in array
    return { fills: [v] };
  },

  background: (v) => EXPANDERS.fill(v, {}),
  bg: (v) => EXPANDERS.fill(v, {}),

  stroke: (v) => {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      // Explicit clear. Without this, "none"/"transparent" used to fall into
      // the else branch below and set strokeAlign="NONE"/"TRANSPARENT" (invalid
      // enum) AND inject default black — leaving the node permanently stuck
      // with a black stroke + invalid align value.
      if (trimmed === 'none' || trimmed === 'transparent') return { strokes: [] };

      const result: Record<string, any> = {};
      // Paren-aware tokenizer — keeps "linear-gradient(135deg, #A 0%, #B 100%)"
      // as one token instead of splitting it on the spaces inside the parens.
      for (const p of splitStrokeTokens(trimmed)) {
        if (p.startsWith('#')) result.strokes = [p];
        else if (p.startsWith('$')) {
          // Variable reference inside the shorthand. Previously fell into
          // the `else` branch below and was silently coerced to strokeAlign
          // (e.g. "$BRAND/600" → strokeAlign="$BRAND/600" — invalid, dropped).
          // Pass through as the variable-ref form so variableBindingHandler
          // can bind it.
          result.strokes = p;
        }
        else if (/-gradient\s*\(/i.test(p)) result.strokes = [p];
        else if (/^\d/.test(p)) result.strokeWeight = parseFloat(p);
        else result.strokeAlign = p.toUpperCase();
      }
      // Inject default black if weight/align specified without color
      if (!result.strokes && (result.strokeWeight || result.strokeAlign)) {
        result.strokes = ['#000000'];
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

  blur: (v) => ({ effects: [{ type: 'LAYER_BLUR', radius: Number(v), visible: true }] }),
  bgblur: (v) => ({ effects: [{ type: 'BACKGROUND_BLUR', radius: Number(v), visible: true }] }),

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
  // `rounded` — Tailwind-style corner alias (preferred canonical name).
  // Same behavior as `radius`/`corner`: number | 'full' | [tl,tr,bl,br] | $varRef.
  rounded: (v, all) => EXPANDERS.radius(v, all),

  // ── Layout details ─────────────────────────────────────────────────────
  smooth: (v) => ({ cornerSmoothing: Number(v) }),
  blend: (v) => ({ blendMode: v }),
  // CSS alias for `radius` — delegate so `'full'`, `[tl,tr,bl,br]`, number,
  // and `$varRef` all behave consistently. Previously a bare passthrough,
  // which let strings like `'12px'` reach Figma raw and throw.
  borderRadius: (v, all) => EXPANDERS.radius(v, all),

  overflow: (v) => {
    const s = String(v).toLowerCase();
    return { clipsContent: v === true || s === 'true' || s === 'hidden' || s === 'clip' };
  },
  // `clips` is an alias for `overflow` — both map to clipsContent
  clips: (v) => {
    const s = String(v).toLowerCase();
    return { clipsContent: v === true || s === 'true' || s === 'hidden' || s === 'clip' };
  },

  wrap: (v) => {
    const s = String(v).toLowerCase();
    if (v === true || s === 'true' || s === '1' || s === 'wrap') return { layoutWrap: 'WRAP' };
    if (v === false || s === 'false' || s === '0' || s === 'nowrap' || s === 'no-wrap') return { layoutWrap: 'NO_WRAP' };
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
  px: (v) => {
    const val = isVarRef(v) ? v : Number(v);
    return { paddingLeft: val, paddingRight: val };
  },
  py: (v) => {
    const val = isVarRef(v) ? v : Number(v);
    return { paddingTop: val, paddingBottom: val };
  },
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
  strokesInLayout: (v) => ({ strokesIncludedInLayout: v === true || String(v).toLowerCase() === 'true' }),
  reverseZ: (v) => ({ itemReverseZIndex: v === true || String(v).toLowerCase() === 'true' }),
  lockRatio: (v) => ({ constrainProportions: v === true || String(v).toLowerCase() === 'true' }),
  pin: (v) => ({ constraints: v }),
  minW: (v) => ({ minWidth: isVarRef(v) ? v : Number(v) }),
  maxW: (v) => ({ maxWidth: isVarRef(v) ? v : Number(v) }),
  minH: (v) => ({ minHeight: isVarRef(v) ? v : Number(v) }),
  maxH: (v) => ({ maxHeight: isVarRef(v) ? v : Number(v) }),

  // ── Hyperlink ───────────────────────────────────────────────────────────
  link: (v) => ({ hyperlink: String(v) }),

  // ── Text decoration & truncation ──────────────────────────────────────
  decoration: (v) => {
    const DECO_MAP: Record<string, string> = {
      underline: 'UNDERLINE', strikethrough: 'STRIKETHROUGH', none: 'NONE',
      'line-through': 'STRIKETHROUGH',
    };
    return { textDecoration: DECO_MAP[norm(String(v))] ?? String(v).toUpperCase() };
  },

  // Style: 'solid' | 'wavy' | 'dotted'
  decorationStyle: (v) => ({ textDecorationStyle: String(v).toUpperCase() }),

  // Thickness/Offset: number → {value:N,unit:'PIXELS'}, 'auto' → {unit:'AUTO'}
  decorationThickness: (v) => {
    if (v === 'auto' || String(v).toUpperCase() === 'AUTO') {
      return { textDecorationThickness: { unit: 'AUTO' } };
    }
    if (typeof v === 'object' && v !== null) return { textDecorationThickness: v };
    const n = Number(v);
    if (!isNaN(n)) return { textDecorationThickness: { value: n, unit: 'PIXELS' } };
    return {};
  },

  decorationOffset: (v) => {
    if (v === 'auto' || String(v).toUpperCase() === 'AUTO') {
      return { textDecorationOffset: { unit: 'AUTO' } };
    }
    if (typeof v === 'object' && v !== null) return { textDecorationOffset: v };
    const n = Number(v);
    if (!isNaN(n)) return { textDecorationOffset: { value: n, unit: 'PIXELS' } };
    return {};
  },

  // Color: hex → {value: SolidPaint}, 'auto' → {value: 'AUTO'}
  decorationColor: (v) => {
    if (v === 'auto' || String(v).toUpperCase() === 'AUTO') {
      return { textDecorationColor: { value: 'AUTO' } };
    }
    if (typeof v === 'object' && v !== null) return { textDecorationColor: v };
    if (typeof v === 'string' && v.startsWith('#')) {
      const rgba = parseHexToRGBA(v);
      return {
        textDecorationColor: {
          value: { type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b }, opacity: rgba.a },
        },
      };
    }
    return {};
  },

  truncate: (v) => {
    if (v === true || String(v).toLowerCase() === 'true') {
      return { textTruncation: 'ENDING', textAutoResize: 'NONE' };
    }
    return { textTruncation: 'DISABLED' };
  },

  maxLines: (v) => ({ maxLines: Number(v), textTruncation: 'ENDING' }),

  whiteSpace: (v) => {
    const WS_MAP: Record<string, string> = {
      nowrap: 'WIDTH_AND_HEIGHT', normal: 'HEIGHT', pre: 'HEIGHT',
    };
    const mapped = WS_MAP[norm(String(v))];
    return mapped ? { textAutoResize: mapped } : {};
  },

  // ── Vector paths (vector node) ─────────────────────────────────────────
  // path="M 0 0 L 10 10 Z"              → single path, NONZERO winding
  // paths=["M...", "M..."]              → multiple paths, all NONZERO
  // paths=[{windingRule:'EVENODD', data:'M...'}]  → raw VectorPath[] passthrough
  // Only absolute SVG commands (M L C Q Z) are supported by Figma.
  path: (v) => {
    if (typeof v !== 'string' || !v.trim()) return {};
    return { vectorPaths: [{ windingRule: 'NONZERO', data: v.trim() }] };
  },

  paths: (v) => {
    if (!Array.isArray(v) || v.length === 0) return {};
    const normalized = v.map((item) => {
      if (typeof item === 'string') return { windingRule: 'NONZERO', data: item };
      return item; // raw VectorPath object pass-through
    });
    return { vectorPaths: normalized };
  },

  // ── Arc (ellipse only) ─────────────────────────────────────────────────
  // Figma arcData uses radians; shorthand accepts degrees for LLM ergonomics.
  // arc="0 270"         → semicircle from 0° to 270°, solid
  // arc="0 270 0.5"     → ring (donut) with 50% inner radius
  // arc="ring 0.5"      → full circle donut (shortcut for arc="0 360 0.5")
  // arc={{startingAngle:0, endingAngle:4.71, innerRadius:0.5}} → raw radians
  // Note: no standalone `innerRadius` shorthand — conflicts with STAR.innerRadius.
  arc: (v) => {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return { arcData: v }; // raw ArcData object passthrough
    }
    const s = String(v).trim();
    // "ring 0.5" shortcut → full circle with inner radius
    const ringMatch = /^ring\s+([\d.]+)$/i.exec(s);
    if (ringMatch) {
      return {
        arcData: { startingAngle: 0, endingAngle: 2 * Math.PI, innerRadius: Number(ringMatch[1]) },
      };
    }
    const parts = s.split(/[\s,]+/).map(Number);
    if (parts.length < 2 || parts.some(isNaN)) return {};
    const DEG = Math.PI / 180;
    return {
      arcData: {
        startingAngle: parts[0] * DEG,
        endingAngle: parts[1] * DEG,
        innerRadius: parts[2] ?? 0,
      },
    };
  },

  // ── Transform ─────────────────────────────────────────────────────────
  // CSS rotate is clockwise-positive; Figma rotation is counter-clockwise-positive
  rotate: (v) => ({ rotation: -(Number(v)) }),

  // ── Font style ────────────────────────────────────────────────────────
  italic: (v) => ({ fontStyle: (v === true || String(v).toLowerCase() === 'true') ? 'italic' : 'normal' }),
  slant: (v) => ({ fontSlant: Number(v) }),

  // ── Image fit ─────────────────────────────────────────────────────────
  fit: (v) => {
    const FIT_MAP: Record<string, string> = {
      cover: 'FILL', contain: 'FIT', none: 'CROP', tile: 'TILE',
      fill: 'FILL', fit: 'FIT', crop: 'CROP',
    };
    return { scaleMode: FIT_MAP[norm(String(v))] ?? String(v).toUpperCase() };
  },

  // ── Outline (basic: strokeAlign OUTSIDE) ──────────────────────────────
  outline: (v) => {
    if (typeof v === 'string') {
      const result: Record<string, any> = { strokeAlign: 'OUTSIDE' };
      for (const p of v.trim().split(/\s+/)) {
        if (p.startsWith('#')) result.strokes = [p];
        else if (/^\d/.test(p)) result.strokeWeight = parseFloat(p);
      }
      if (!result.strokes && result.strokeWeight) result.strokes = ['#000000'];
      return result;
    }
    return {};
  },
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
