/**
 * @file property-specs.ts
 * @description PropertySpec interface and implementations for complex property types.
 *
 * Each spec defines the complete lifecycle of a property value:
 *   XML string ←→ IR value ←→ Figma API value
 *
 * Only properties that need type conversion get a spec:
 *   - paint (fills/strokes)
 *   - effect (effects)
 *   - unitValue (lineHeight, letterSpacing)
 *   - constraints
 *   - fontName (fontFamily + fontWeight → FontName)
 *
 * Simple scalar properties (fontSize, cornerRadius, opacity, etc.) do NOT need
 * specs — they pass through as-is via coerceValue().
 */

import type {
  EffectValue,
  UnitValue,
  ConstraintValue,
  FontNameValue,
  RGBA,
  GradientType,
  ConstraintType,
  Vector,
} from './design-ir';
import { isGradientString, parseGradient, getGradientTransform } from './gradient-parser';

// ═══════════════════════════════════════════════
// PropertySpec Interface
// ═══════════════════════════════════════════════

export interface PropertySpec<T> {
  /** XML attribute names this spec handles (including aliases) */
  xmlAttrs: string[];
  /** Parse an XML attribute string → IR value */
  parseXml(value: string): T;
  /** Format an IR value → XML attribute string */
  formatXml(value: T): string;
  /** Convert a Figma API value → IR value */
  fromFigma(figmaValue: any): T;
  /** Convert an IR value → Figma API value */
  toFigma(value: T): any;
  /** Compare two IR values for semantic equality */
  isEqual(a: T, b: T): boolean;
  /** Default value (for pruning/skipping on output) */
  defaultValue?: T;
}

// ═══════════════════════════════════════════════
// Color helpers (shared across specs)
// ═══════════════════════════════════════════════

export function parseHexToRGBA(hex: string): RGBA {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return { r, g, b, a: 1 };
  }
  if (clean.length === 6 || clean.length === 8) {
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    const a = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1;
    if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) {
      return { r: 0, g: 0, b: 0, a: 1 };
    }
    return { r, g, b, a };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

export function rgbaToHex(rgba: RGBA): string {
  const toHex = (c: number) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0');
  const hex = `#${toHex(rgba.r)}${toHex(rgba.g)}${toHex(rgba.b)}`.toUpperCase();
  if (rgba.a !== undefined && rgba.a < 1) {
    return `${hex}${toHex(rgba.a)}`.toUpperCase();
  }
  return hex;
}

// ═══════════════════════════════════════════════
// Paint — Direct Figma Paint format (no IR layer)
//
// Write: string/"object" → Figma Paint (fill defaults)
// Read:  Figma Paint → strip defaults → string/object
// ═══════════════════════════════════════════════

/**
 * Parse a single paint input directly to a Figma Paint object.
 * Accepts:
 *   - "#FF0000"            → {type:'SOLID', color:{r:1,g:0,b:0}, opacity:1}
 *   - "linear-gradient(…)" → {type:'GRADIENT_LINEAR', gradientStops:[…], gradientTransform:[…]}
 *   - {color:"#FF0000", blendMode:"MULTIPLY", opacity:0.5} → merged into Figma Paint
 */
export function parsePaintToFigma(input: string | Record<string, any>): any {
  if (typeof input === 'string') {
    const trimmed = input.trim();

    // CSS gradient
    if (isGradientString(trimmed)) {
      const parsed = parseGradient(trimmed);
      if (parsed) {
        return {
          type: parsed.type,
          gradientStops: parsed.stops.map(s => ({ color: s.color, position: s.position })),
          gradientTransform: getGradientTransform(parsed.type, parsed.angleDeg),
        };
      }
    }

    // Legacy gradient: GRADIENT_LINEAR(#color@pos,…)
    const gm = trimmed.match(/^(GRADIENT_\w+)\((.+)\)$/);
    if (gm) {
      const stops = gm[2].split(',').map(s => {
        const [colorStr, posStr] = s.trim().split('@');
        return { color: parseHexToRGBA(colorStr), position: parseFloat(posStr) || 0 };
      });
      return {
        type: gm[1],
        gradientStops: stops,
        gradientTransform: getGradientTransform(gm[1] as GradientType, 180),
      };
    }

    // Solid hex
    const rgba = parseHexToRGBA(trimmed);
    return { type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b }, opacity: rgba.a };
  }

  // Object: {color:"#FF0000", blendMode:"MULTIPLY", opacity:0.5}
  if (typeof input === 'object' && input !== null && input.color) {
    const rgba = parseHexToRGBA(input.color);
    const paint: any = { type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b }, opacity: rgba.a };
    if (input.opacity !== undefined) paint.opacity = input.opacity;
    if (input.blendMode) paint.blendMode = input.blendMode;
    if (input.visible !== undefined) paint.visible = input.visible;
    return paint;
  }

  // Fallback
  return { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 };
}

/**
 * Format a single Figma Paint for LLM display — strip defaults.
 *   All defaults → "#FF0000"
 *   Non-defaults → {color:"#FF0000", opacity:0.5, blendMode:"MULTIPLY"}
 */
export function formatPaintForLLM(paint: any): string | Record<string, any> {
  if (!paint || typeof paint !== 'object') return '#000000';

  if (paint.type === 'SOLID') {
    const { r, g, b } = paint.color || { r: 0, g: 0, b: 0 };
    const opacity = paint.opacity ?? 1;
    const hex = rgbaToHex({ r, g, b, a: opacity });

    const hasNonDefaults =
      (paint.blendMode && paint.blendMode !== 'NORMAL') ||
      (paint.visible === false);
    if (!hasNonDefaults) return hex;

    const result: Record<string, any> = { color: hex };
    if (paint.blendMode && paint.blendMode !== 'NORMAL') result.blendMode = paint.blendMode;
    if (paint.visible === false) result.visible = false;
    return result;
  }

  if (typeof paint.type === 'string' && paint.type.startsWith('GRADIENT')) {
    const stops = (paint.gradientStops || [])
      .map((s: any) => `${rgbaToHex(s.color)}@${s.position}`)
      .join(',');
    return `${paint.type}(${stops})`;
  }

  if (paint.type === 'IMAGE') {
    return `IMAGE(${paint.imageHash || ''})`;
  }

  return '#000000';
}

function figmaPaintsEqual(a: any, b: any): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'SOLID') {
    return Math.abs((a.color?.r ?? 0) - (b.color?.r ?? 0)) < 0.01 &&
      Math.abs((a.color?.g ?? 0) - (b.color?.g ?? 0)) < 0.01 &&
      Math.abs((a.color?.b ?? 0) - (b.color?.b ?? 0)) < 0.01 &&
      Math.abs((a.opacity ?? 1) - (b.opacity ?? 1)) < 0.01;
  }
  if (a.type?.startsWith('GRADIENT')) {
    const aStops = a.gradientStops || [];
    const bStops = b.gradientStops || [];
    if (aStops.length !== bStops.length) return false;
    return aStops.every((s: any, i: number) => {
      const os = bStops[i];
      return Math.abs(s.position - os.position) < 0.01 &&
        Math.abs(s.color.r - os.color.r) < 0.01 &&
        Math.abs(s.color.g - os.color.g) < 0.01 &&
        Math.abs(s.color.b - os.color.b) < 0.01 &&
        Math.abs((s.color.a ?? 1) - (os.color.a ?? 1)) < 0.01;
    });
  }
  if (a.type === 'IMAGE') return a.imageHash === b.imageHash;
  return false;
}

export const paintSpec = {
  xmlAttrs: ['fill', 'fills', 'stroke', 'strokes', 'background', 'bg'],

  /** Parse paint string(s) directly to Figma Paint[]. */
  parseXml(value: string): any[] {
    if (value === 'transparent' || value === 'none') return [];
    return splitRespectingParens(value).map(s => parsePaintToFigma(s));
  },

  /** Format Figma Paint[] to string. */
  formatXml(paints: any[]): string {
    if (!paints || paints.length === 0) return 'transparent';
    return paints.map(p => {
      const f = formatPaintForLLM(p);
      return typeof f === 'string' ? f : JSON.stringify(f);
    }).join(',');
  },

  /** Filter invisible paints. No IR conversion — paints stay as Figma format. */
  fromFigma(figmaValue: any): any[] {
    if (!Array.isArray(figmaValue)) return [];
    return figmaValue.filter((p: any) => p.visible !== false);
  },

  /** Identity — values are already Figma Paint format. */
  toFigma(value: any[]): any[] {
    return value;
  },

  isEqual(a: any[], b: any[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((v, i) => figmaPaintsEqual(v, b[i]));
  },

  validate(value: string): string[] {
    if (value === 'transparent' || value === 'none') return [];
    return splitRespectingParens(value)
      .filter(p => !p.startsWith('#') && !p.startsWith('GRADIENT_') && !p.startsWith('IMAGE(') && !isGradientString(p))
      .map(p => `Invalid paint format "${p}". Use "#RRGGBB[AA]", "GRADIENT_LINEAR(#color@pos,...)", or "linear-gradient(...)".`);
  },

  defaultValue: [],
};

// ═══════════════════════════════════════════════
// Effect Spec
// ═══════════════════════════════════════════════

/**
 * Parses XML effect value. Formats:
 *   Shadow:      "ox,oy,blur,spread,color"
 *   InnerShadow: "inset,ox,oy,blur,spread,color"
 *   Blur:        "blur(radius)"
 *   BgBlur:      "bgblur(radius)"
 *   Multiple:    separated by ";"
 */
function parseSingleEffectXml(value: string): EffectValue {
  const trimmed = value.trim();

  // blur(radius)
  const blurMatch = trimmed.match(/^blur\((\d+(?:\.\d+)?)\)$/);
  if (blurMatch) {
    return { kind: 'blur', type: 'layer', radius: parseFloat(blurMatch[1]) };
  }

  // bgblur(radius)
  const bgBlurMatch = trimmed.match(/^bgblur\((\d+(?:\.\d+)?)\)$/);
  if (bgBlurMatch) {
    return { kind: 'blur', type: 'background', radius: parseFloat(bgBlurMatch[1]) };
  }

  // Shadow: [inset,]ox,oy,blur,spread,color
  const isInner = trimmed.toLowerCase().startsWith('inset,');
  const params = isInner ? trimmed.substring(6) : trimmed;
  const [oxStr, oyStr, blurStr, spreadStr, colorStr] = params.split(',').map(s => s.trim());

  const color = parseHexToRGBA(colorStr || '#0000001A');
  const offset: Vector = { x: parseFloat(oxStr) || 0, y: parseFloat(oyStr) || 0 };

  return {
    kind: isInner ? 'inner-shadow' : 'drop-shadow',
    color,
    offset,
    radius: parseFloat(blurStr) || 0,
    spread: parseFloat(spreadStr) || 0,
  };
}

function formatSingleEffectXml(effect: EffectValue): string {
  switch (effect.kind) {
    case 'blur':
      return effect.type === 'background'
        ? `bgblur(${effect.radius})`
        : `blur(${effect.radius})`;
    case 'drop-shadow':
    case 'inner-shadow': {
      const prefix = effect.kind === 'inner-shadow' ? 'inset,' : '';
      const colorHex = rgbaToHex(effect.color);
      return `${prefix}${effect.offset.x},${effect.offset.y},${effect.radius},${effect.spread},${colorHex}`;
    }
  }
}

function effectFromFigma(figmaEffect: any): EffectValue {
  if (figmaEffect.type === 'DROP_SHADOW' || figmaEffect.type === 'INNER_SHADOW') {
    const color: RGBA = figmaEffect.color
      ? { r: figmaEffect.color.r, g: figmaEffect.color.g, b: figmaEffect.color.b, a: figmaEffect.color.a ?? 1 }
      : { r: 0, g: 0, b: 0, a: 0.1 };
    return {
      kind: figmaEffect.type === 'INNER_SHADOW' ? 'inner-shadow' : 'drop-shadow',
      color,
      offset: figmaEffect.offset || { x: 0, y: 0 },
      radius: figmaEffect.radius ?? 0,
      spread: figmaEffect.spread ?? 0,
    };
  }
  if (figmaEffect.type === 'LAYER_BLUR' || figmaEffect.type === 'BACKGROUND_BLUR') {
    return {
      kind: 'blur',
      type: figmaEffect.type === 'BACKGROUND_BLUR' ? 'background' : 'layer',
      radius: figmaEffect.radius ?? 0,
    };
  }
  // Fallback
  return { kind: 'blur', type: 'layer', radius: 0 };
}

function effectToFigma(effect: EffectValue): any {
  switch (effect.kind) {
    case 'drop-shadow':
      return {
        type: 'DROP_SHADOW',
        color: effect.color,
        offset: effect.offset,
        radius: effect.radius,
        spread: effect.spread,
        visible: true,
        blendMode: 'NORMAL',
      };
    case 'inner-shadow':
      return {
        type: 'INNER_SHADOW',
        color: effect.color,
        offset: effect.offset,
        radius: effect.radius,
        spread: effect.spread,
        visible: true,
        blendMode: 'NORMAL',
      };
    case 'blur':
      return {
        type: effect.type === 'background' ? 'BACKGROUND_BLUR' : 'LAYER_BLUR',
        radius: effect.radius,
        visible: true,
      };
  }
}

function effectsEqual(a: EffectValue, b: EffectValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'blur' && b.kind === 'blur') {
    return a.type === b.type && a.radius === b.radius;
  }
  if ((a.kind === 'drop-shadow' || a.kind === 'inner-shadow') &&
      (b.kind === 'drop-shadow' || b.kind === 'inner-shadow')) {
    return (
      a.offset.x === b.offset.x &&
      a.offset.y === b.offset.y &&
      a.radius === b.radius &&
      a.spread === b.spread &&
      Math.abs(a.color.r - b.color.r) < 0.01 &&
      Math.abs(a.color.g - b.color.g) < 0.01 &&
      Math.abs(a.color.b - b.color.b) < 0.01 &&
      Math.abs(a.color.a - b.color.a) < 0.01
    );
  }
  return false;
}

export const effectSpec: PropertySpec<EffectValue[]> = {
  xmlAttrs: ['shadow', 'effects'],

  parseXml(value: string): EffectValue[] {
    return value.split(';').map(s => s.trim()).filter(Boolean).map(parseSingleEffectXml);
  },

  formatXml(value: EffectValue[]): string {
    return value.map(formatSingleEffectXml).join(';');
  },

  fromFigma(figmaValue: any): EffectValue[] {
    if (!Array.isArray(figmaValue)) return [];
    return figmaValue
      .filter((e: any) => e.visible !== false)
      .map(effectFromFigma);
  },

  toFigma(value: EffectValue[]): any[] {
    return value.map(effectToFigma);
  },

  isEqual(a: EffectValue[], b: EffectValue[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((v, i) => effectsEqual(v, b[i]));
  },

  defaultValue: [],
};

// ═══════════════════════════════════════════════
// UnitValue Spec
// ═══════════════════════════════════════════════

/**
 * Parses XML unit value. Formats:
 *   Pixels:  "24" or "24px"
 *   Percent: "160%"
 *   Auto:    "auto"
 */
export const unitValueSpec: PropertySpec<UnitValue> = {
  xmlAttrs: ['lineHeight', 'leading', 'letterSpacing', 'tracking'],

  parseXml(value: string): UnitValue {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'auto') return { value: 0, unit: 'AUTO' };
    if (trimmed.endsWith('%')) return { value: parseFloat(trimmed), unit: 'PERCENT' };
    return { value: parseFloat(trimmed), unit: 'PIXELS' };
  },

  formatXml(value: UnitValue): string {
    if (value.unit === 'AUTO') return 'auto';
    if (value.unit === 'PERCENT') return `${value.value}%`;
    return String(value.value);
  },

  fromFigma(figmaValue: any): UnitValue {
    if (!figmaValue || typeof figmaValue !== 'object') {
      if (typeof figmaValue === 'number') return { value: figmaValue, unit: 'PIXELS' };
      return { value: 0, unit: 'AUTO' };
    }
    if (figmaValue.unit === 'AUTO') return { value: 0, unit: 'AUTO' };
    if (figmaValue.unit === 'PERCENT') return { value: figmaValue.value, unit: 'PERCENT' };
    return { value: figmaValue.value ?? 0, unit: 'PIXELS' };
  },

  toFigma(value: UnitValue): any {
    if (value.unit === 'AUTO') return { value: 0, unit: 'AUTO' };
    return { value: value.value, unit: value.unit };
  },

  isEqual(a: UnitValue, b: UnitValue): boolean {
    if (a.unit !== b.unit) return false;
    if (a.unit === 'AUTO') return true;
    return Math.abs(a.value - b.value) < 0.01;
  },

  defaultValue: { value: 0, unit: 'AUTO' },
};

// ═══════════════════════════════════════════════
// Constraints Spec
// ═══════════════════════════════════════════════

const CONSTRAINT_VALUES = new Set(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE']);

function parseConstraintType(value: string): ConstraintType {
  const upper = value.toUpperCase().trim();
  if (CONSTRAINT_VALUES.has(upper)) return upper as ConstraintType;
  return 'MIN';
}

export const constraintsSpec: PropertySpec<ConstraintValue> = {
  xmlAttrs: ['constraints'],

  parseXml(value: string): ConstraintValue {
    // Format: "horizontal,vertical" e.g. "MIN,MIN" or "CENTER,STRETCH"
    const parts = value.split(',').map(s => s.trim());
    return {
      horizontal: parseConstraintType(parts[0] || 'MIN'),
      vertical: parseConstraintType(parts[1] || 'MIN'),
    };
  },

  formatXml(value: ConstraintValue): string {
    return `${value.horizontal},${value.vertical}`;
  },

  fromFigma(figmaValue: any): ConstraintValue {
    if (!figmaValue || typeof figmaValue !== 'object') {
      return { horizontal: 'MIN', vertical: 'MIN' };
    }
    return {
      horizontal: (figmaValue.horizontal as ConstraintType) || 'MIN',
      vertical: (figmaValue.vertical as ConstraintType) || 'MIN',
    };
  },

  toFigma(value: ConstraintValue): any {
    return { horizontal: value.horizontal, vertical: value.vertical };
  },

  isEqual(a: ConstraintValue, b: ConstraintValue): boolean {
    return a.horizontal === b.horizontal && a.vertical === b.vertical;
  },

  defaultValue: { horizontal: 'MIN', vertical: 'MIN' },
};

// ═══════════════════════════════════════════════
// FontName Spec
// ═══════════════════════════════════════════════

export const fontNameSpec: PropertySpec<FontNameValue> = {
  xmlAttrs: ['fontFamily', 'font', 'fontWeight', 'weight'],

  parseXml(value: string): FontNameValue {
    // Format: "family/style" e.g. "Inter/Bold" or just "Inter"
    if (value.includes('/')) {
      const [family, style] = value.split('/');
      return { family: family.trim(), style: style.trim() };
    }
    return { family: value.trim(), style: 'Regular' };
  },

  formatXml(value: FontNameValue): string {
    if (value.style === 'Regular') return value.family;
    return `${value.family}/${value.style}`;
  },

  fromFigma(figmaValue: any): FontNameValue {
    if (!figmaValue || typeof figmaValue !== 'object') {
      return { family: 'Inter', style: 'Regular' };
    }
    return {
      family: figmaValue.family || 'Inter',
      style: figmaValue.style || 'Regular',
    };
  },

  toFigma(value: FontNameValue): any {
    return { family: value.family, style: value.style };
  },

  isEqual(a: FontNameValue, b: FontNameValue): boolean {
    return a.family === b.family && a.style === b.style;
  },

  defaultValue: { family: 'Inter', style: 'Regular' },
};

// ═══════════════════════════════════════════════
// Registry (all specs by canonical property name)
// ═══════════════════════════════════════════════

export const PROPERTY_SPECS: Record<string, PropertySpec<any>> = {
  fills: paintSpec,
  strokes: paintSpec,
  effects: effectSpec,
  lineHeight: unitValueSpec,
  letterSpacing: unitValueSpec,
  constraints: constraintsSpec,
  fontName: fontNameSpec,
};

// ═══════════════════════════════════════════════
// Utility: split by comma but respect parentheses
// ═══════════════════════════════════════════════

function splitRespectingParens(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) {
      parts.push(s.substring(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(s.substring(start).trim());
  return parts.filter(Boolean);
}
