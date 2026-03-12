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
  PaintValue,
  EffectValue,
  UnitValue,
  ConstraintValue,
  FontNameValue,
  RGBA,
  ColorStop,
  GradientType,
  ConstraintType,
  Vector,
} from './design-ir';

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
// Paint Spec
// ═══════════════════════════════════════════════

/**
 * Parses XML paint value. Formats:
 *   Solid:    "#FF0000"
 *   Gradient: "GRADIENT_LINEAR(#FF0000@0,#0000FF@1)"
 *   Multiple: "#FF0000,#00FF00" (comma-separated solids)
 */
function parseSinglePaintXml(value: string): PaintValue {
  const trimmed = value.trim();

  // Gradient: GRADIENT_LINEAR(#color@pos,#color@pos)
  const gradientMatch = trimmed.match(/^(GRADIENT_\w+)\((.+)\)$/);
  if (gradientMatch) {
    const type = gradientMatch[1] as GradientType;
    const stopsStr = gradientMatch[2];
    const stops: ColorStop[] = stopsStr.split(',').map(s => {
      const parts = s.trim().split('@');
      const colorStr = parts[0];
      const position = parts[1] !== undefined ? parseFloat(parts[1]) : 0;
      return { color: parseHexToRGBA(colorStr), position };
    });
    return { kind: 'gradient', type, stops };
  }

  // Solid hex color
  return { kind: 'solid', color: trimmed };
}

function formatSinglePaintXml(paint: PaintValue): string {
  switch (paint.kind) {
    case 'solid':
      return paint.color;
    case 'gradient': {
      const stops = paint.stops
        .map(s => `${rgbaToHex(s.color)}@${s.position}`)
        .join(',');
      return `${paint.type}(${stops})`;
    }
    case 'image':
      return `IMAGE(${paint.imageHash})`;
  }
}

function paintFromFigma(figmaPaint: any): PaintValue {
  if (!figmaPaint || typeof figmaPaint !== 'object') {
    return { kind: 'solid', color: '#000000' };
  }

  if (figmaPaint.type === 'SOLID') {
    const { r, g, b } = figmaPaint.color;
    const hex = rgbaToHex({ r, g, b, a: figmaPaint.opacity ?? 1 });
    return { kind: 'solid', color: hex };
  }

  if (typeof figmaPaint.type === 'string' && figmaPaint.type.startsWith('GRADIENT')) {
    const stops: ColorStop[] = (figmaPaint.gradientStops || []).map((s: any) => ({
      color: {
        r: s.color?.r ?? 0,
        g: s.color?.g ?? 0,
        b: s.color?.b ?? 0,
        a: s.color?.a ?? 1,
      },
      position: s.position ?? 0,
    }));
    return {
      kind: 'gradient',
      type: figmaPaint.type as GradientType,
      stops,
    };
  }

  if (figmaPaint.type === 'IMAGE') {
    return {
      kind: 'image',
      imageHash: figmaPaint.imageHash ?? '',
      scaleMode: figmaPaint.scaleMode ?? 'FILL',
    };
  }

  // Fallback: treat as solid black
  return { kind: 'solid', color: '#000000' };
}

function paintToFigma(paint: PaintValue): any {
  switch (paint.kind) {
    case 'solid': {
      const rgba = parseHexToRGBA(paint.color);
      return {
        type: 'SOLID',
        color: { r: rgba.r, g: rgba.g, b: rgba.b },
        opacity: rgba.a,
      };
    }
    case 'gradient': {
      return {
        type: paint.type,
        gradientStops: paint.stops.map(s => ({
          color: s.color,
          position: s.position,
        })),
        gradientTransform: [[1, 0, 0], [0, 1, 0]], // identity transform
      };
    }
    case 'image': {
      return {
        type: 'IMAGE',
        imageHash: paint.imageHash,
        scaleMode: paint.scaleMode,
      };
    }
  }
}

function paintsEqual(a: PaintValue, b: PaintValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'solid' && b.kind === 'solid') {
    return a.color.toUpperCase() === b.color.toUpperCase();
  }
  if (a.kind === 'gradient' && b.kind === 'gradient') {
    if (a.type !== b.type) return false;
    if (a.stops.length !== b.stops.length) return false;
    return a.stops.every((s, i) => {
      const other = b.stops[i];
      return s.position === other.position &&
        Math.abs(s.color.r - other.color.r) < 0.01 &&
        Math.abs(s.color.g - other.color.g) < 0.01 &&
        Math.abs(s.color.b - other.color.b) < 0.01 &&
        Math.abs(s.color.a - other.color.a) < 0.01;
    });
  }
  if (a.kind === 'image' && b.kind === 'image') {
    return a.imageHash === b.imageHash;
  }
  return false;
}

export const paintSpec = {
  xmlAttrs: ['fill', 'fills', 'stroke', 'strokes', 'background', 'bg'],

  parseXml(value: string): PaintValue[] {
    if (value === 'transparent' || value === 'none') return [];
    // Split by comma, but respect parentheses (for gradient notation)
    const parts = splitRespectingParens(value);
    return parts.map(parseSinglePaintXml);
  },

  formatXml(value: PaintValue[]): string {
    if (value.length === 0) return 'transparent';
    return value.map(formatSinglePaintXml).join(',');
  },

  fromFigma(figmaValue: any): PaintValue[] {
    if (!Array.isArray(figmaValue)) return [];
    return figmaValue
      .filter((p: any) => p.visible !== false)
      .map(paintFromFigma);
  },

  toFigma(value: PaintValue[]): any[] {
    return value.map(paintToFigma);
  },

  isEqual(a: PaintValue[], b: PaintValue[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((v, i) => paintsEqual(v, b[i]));
  },

  /** Returns warning strings for any unrecognized paint parts (before parsing). */
  validate(value: string): string[] {
    if (value === 'transparent' || value === 'none') return [];
    return splitRespectingParens(value)
      .filter(p => !p.startsWith('#') && !p.startsWith('GRADIENT_') && !p.startsWith('IMAGE('))
      .map(p => `Invalid paint format "${p}". Use "#RRGGBB[AA]" for solid or "GRADIENT_LINEAR(#color@pos,...)" for gradients. Rendered as black.`);
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
