/**
 * @file figma-api.ts
 * @description Single Source of Truth for Figma Plugin API properties.
 * 
 * ACTS AS A "CAPABILITY MANIFEST" (Allowlist):
 * Defines the strict intersection of:
 * 1. What Figma API supports
 * 2. What our Renderer implementation supports
 * 3. What we allow the LLM to generate
 * 
 * USAGE:
 * - Schema: Uses these values for JSON keys
 * - Prompt: Uses these values to instruct LLM
 * - Parser: Maps legacy DSL to these values
 * - Renderer: Reads properties using these keys
 */

export const PROPS = {
  // ==========================
  // Core Identity
  // ==========================
  name: 'name',
  visible: 'visible',
  opacity: 'opacity',

  // ==========================
  // Layout (Auto Layout)
  // ==========================
  layoutMode: 'layoutMode',                // Replaces legacy "layout"
  layoutSizingHorizontal: 'layoutSizingHorizontal',
  layoutSizingVertical: 'layoutSizingVertical',
  primaryAxisAlignItems: 'primaryAxisAlignItems',
  counterAxisAlignItems: 'counterAxisAlignItems',
  padding: 'padding',
  paddingTop: 'paddingTop',
  paddingRight: 'paddingRight',
  paddingBottom: 'paddingBottom',
  paddingLeft: 'paddingLeft',
  gap: 'gap',
  counterAxisSpacing: 'counterAxisSpacing',
  layoutGrow: 'layoutGrow',
  layoutAlign: 'layoutAlign',
  layoutPositioning: 'layoutPositioning',  // AUTO | ABSOLUTE (child of auto-layout parent)
  constraints: 'constraints',              // { horizontal, vertical } pin/scale behavior
  x: 'x',                                  // Absolute/local X position
  y: 'y',                                  // Absolute/local Y position
  width: 'width',                         // For fixed size
  height: 'height',                       // For fixed size

  // ==========================
  // Styling (Appearance)
  // ==========================
  fills: 'fills',                         // Replaces legacy "color" for Text
  strokes: 'strokes',
  strokeWeight: 'strokeWeight',
  strokeAlign: 'strokeAlign',
  strokeJoin: 'strokeJoin',                // enum: MITER | BEVEL | ROUND
  strokeCap: 'strokeCap',                  // enum: NONE | ROUND | SQUARE | ARROW_LINES | ARROW_EQUILATERAL
  dashPattern: 'dashPattern',              // number[]: e.g. [10,5] for dashed
  strokeTopWeight: 'strokeTopWeight',      // number: per-side stroke weight
  strokeRightWeight: 'strokeRightWeight',
  strokeBottomWeight: 'strokeBottomWeight',
  strokeLeftWeight: 'strokeLeftWeight',
  cornerRadius: 'cornerRadius',
  cornerSmoothing: 'cornerSmoothing',
  effects: 'effects',
  blendMode: 'blendMode',                  // enum: NORMAL | MULTIPLY | SCREEN | etc.

  // ==========================
  // Text Properties
  // ==========================
  characters: 'characters',               // Replaces legacy "content"
  fontName: 'fontName',
  fontSize: 'fontSize',
  fontWeight: 'fontWeight',               // Virtual: maps to fontName.style
  fontFamily: 'fontFamily',               // Virtual: maps to fontName.family
  textAlign: 'textAlignHorizontal',       // Alias for cleaner code / backward compat
  textAlignHorizontal: 'textAlignHorizontal',
  textAlignVertical: 'textAlignVertical',
  textAutoResize: 'textAutoResize',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
  textCase: 'textCase',
  textDecoration: 'textDecoration',
  textTruncation: 'textTruncation',       // 'DISABLED' | 'ENDING'
  maxLines: 'maxLines',                    // number | null
  paragraphSpacing: 'paragraphSpacing',
  paragraphIndent: 'paragraphIndent',

  // ==========================
  // Component / Meta
  // ==========================
  iconName: 'iconName',                   // Virtual: Icon lookup key
  semantic: 'semantic',                   // Virtual: Design System component role
  variant: 'variant',                     // Virtual: Design System variant
  svgContent: 'svgContent',               // Virtual: Embedded SVG data
  rotation: 'rotation',                   // New: Rotation in degrees

  // ==========================
  // Frame Clipping & Wrap
  // ==========================
  clipsContent: 'clipsContent',            // boolean: clip children at frame boundary
  layoutWrap: 'layoutWrap',                // enum: WRAP | NO_WRAP (flex-wrap for auto-layout)
  strokesIncludedInLayout: 'strokesIncludedInLayout', // boolean: include strokes in layout size calculation
  itemReverseZIndex: 'itemReverseZIndex',  // boolean: reverse stacking order (first on top)
  minWidth: 'minWidth',                    // number | null: min width constraint
  maxWidth: 'maxWidth',                    // number | null: max width constraint
  minHeight: 'minHeight',                  // number | null: min height constraint
  maxHeight: 'maxHeight',                  // number | null: max height constraint
  constrainProportions: 'constrainProportions', // boolean: lock aspect ratio
} as const;

/**
 * Property Metadata for Unified Mapping (Figma <-> DSL)
 * This centralizes how each property is extracted and rendered.
 */
export interface SizingConstraint {
  readonly requiresAutoLayout: 'self' | 'parent';
  readonly fallback: string;
}

export interface PropDefinition {
  readonly figmaKey: string;
  readonly type: 'scalar' | 'color' | 'enum' | 'object' | 'virtual' | 'array' | 'string';
  readonly enumMap?: Record<string, string>;
  readonly defaultValue?: any; // [PURE TRUST] Centralized default for data-driven transformation
  // NEW: Normalization rules
  readonly min?: number;        // scalar clamp lower bound
  readonly max?: number;        // scalar clamp upper bound
  readonly valueConstraints?: Record<string, SizingConstraint>;
}

export const PROP_METADATA: Record<string, PropDefinition> = {
  [PROPS.name]: { figmaKey: 'name', type: 'string' },
  [PROPS.visible]: { figmaKey: 'visible', type: 'scalar', defaultValue: true },
  [PROPS.opacity]: { figmaKey: 'opacity', type: 'scalar', defaultValue: 1, min: 0, max: 1 },
  
  // Layout
  [PROPS.layoutMode]: { 
    figmaKey: 'layoutMode', 
    type: 'enum', 
    enumMap: { 'VERTICAL': 'VERTICAL', 'HORIZONTAL': 'HORIZONTAL', 'NONE': 'NONE' },
    defaultValue: 'NONE'
  },
  [PROPS.layoutSizingHorizontal]: {
    figmaKey: 'layoutSizingHorizontal', type: 'enum',
    enumMap: { FIXED: 'FIXED', FILL: 'FILL', HUG: 'HUG', AUTO: 'HUG', STRETCH: 'FILL' },
    defaultValue: 'FIXED',
    valueConstraints: {
      HUG:  { requiresAutoLayout: 'self',   fallback: 'FIXED' },
      FILL: { requiresAutoLayout: 'parent', fallback: 'HUG' },
    },
  },
  [PROPS.layoutSizingVertical]: {
    figmaKey: 'layoutSizingVertical', type: 'enum',
    enumMap: { FIXED: 'FIXED', FILL: 'FILL', HUG: 'HUG', AUTO: 'HUG', STRETCH: 'FILL' },
    defaultValue: 'FIXED',
    valueConstraints: {
      HUG:  { requiresAutoLayout: 'self',   fallback: 'FIXED' },
      FILL: { requiresAutoLayout: 'parent', fallback: 'HUG' },
    },
  },
  [PROPS.primaryAxisAlignItems]: {
    figmaKey: 'primaryAxisAlignItems', type: 'enum',
    enumMap: { MIN: 'MIN', CENTER: 'CENTER', MAX: 'MAX', SPACE_BETWEEN: 'SPACE_BETWEEN' },
    defaultValue: 'MIN'
  },
  [PROPS.counterAxisAlignItems]: {
    figmaKey: 'counterAxisAlignItems', type: 'enum',
    enumMap: { MIN: 'MIN', CENTER: 'CENTER', MAX: 'MAX', BASELINE: 'BASELINE' },
    defaultValue: 'MIN'
  },
  [PROPS.gap]: { figmaKey: 'itemSpacing', type: 'scalar', defaultValue: 0, min: 0, max: 1000 }, // Note: itemSpacing in Figma API
  [PROPS.counterAxisSpacing]: { figmaKey: 'counterAxisSpacing', type: 'scalar', defaultValue: 0, min: 0, max: 1000 },
  [PROPS.paddingTop]: { figmaKey: 'paddingTop', type: 'scalar', defaultValue: 0, min: 0, max: 1000 },
  [PROPS.paddingRight]: { figmaKey: 'paddingRight', type: 'scalar', defaultValue: 0, min: 0, max: 1000 },
  [PROPS.paddingBottom]: { figmaKey: 'paddingBottom', type: 'scalar', defaultValue: 0, min: 0, max: 1000 },
  [PROPS.paddingLeft]: { figmaKey: 'paddingLeft', type: 'scalar', defaultValue: 0, min: 0, max: 1000 },
  [PROPS.layoutGrow]: { figmaKey: 'layoutGrow', type: 'scalar', defaultValue: 0, min: 0, max: 1 },
  [PROPS.layoutAlign]: {
    figmaKey: 'layoutAlign',
    type: 'enum',
    enumMap: {
      'MIN': 'MIN',
      'CENTER': 'CENTER',
      'MAX': 'MAX',
      'STRETCH': 'STRETCH',
      'INHERIT': 'INHERIT'
    },
    defaultValue: 'INHERIT'
  },
  [PROPS.layoutPositioning]: {
    figmaKey: 'layoutPositioning',
    type: 'enum',
    enumMap: {
      'AUTO': 'AUTO',
      'RELATIVE': 'AUTO',
      'ABSOLUTE': 'ABSOLUTE'
    },
    defaultValue: 'AUTO'
  },
  [PROPS.constraints]: {
    figmaKey: 'constraints',
    type: 'object',
    defaultValue: { horizontal: 'MIN', vertical: 'MIN' }
  },
  [PROPS.x]: { figmaKey: 'x', type: 'scalar', defaultValue: 0 },
  [PROPS.y]: { figmaKey: 'y', type: 'scalar', defaultValue: 0 },
  [PROPS.width]: { figmaKey: 'width', type: 'scalar', min: 0.01, max: 10000 },
  [PROPS.height]: { figmaKey: 'height', type: 'scalar', min: 0.01, max: 10000 },

  // Styling
  [PROPS.fills]: { figmaKey: 'fills', type: 'color', defaultValue: [] },
  [PROPS.strokes]: { figmaKey: 'strokes', type: 'color', defaultValue: [] },
  [PROPS.strokeWeight]: { figmaKey: 'strokeWeight', type: 'scalar', defaultValue: 0, min: 0, max: 100 },
  [PROPS.cornerRadius]: { figmaKey: 'cornerRadius', type: 'scalar', defaultValue: 0, min: 0, max: 1000 },
  [PROPS.effects]: { figmaKey: 'effects', type: 'array', defaultValue: [] },

  // Text
  [PROPS.characters]: { figmaKey: 'characters', type: 'string' },
  [PROPS.fontSize]: { figmaKey: 'fontSize', type: 'scalar', min: 1, max: 1000 },
  [PROPS.fontWeight]: { figmaKey: 'fontWeight', type: 'virtual' }, // Maps to fontName.style
  [PROPS.fontFamily]: { figmaKey: 'fontFamily', type: 'virtual' }, // Maps to fontName.family
  [PROPS.textAlignHorizontal]: { figmaKey: 'textAlignHorizontal', type: 'enum', enumMap: { LEFT: 'LEFT', CENTER: 'CENTER', RIGHT: 'RIGHT', JUSTIFIED: 'JUSTIFIED' } },
  [PROPS.textAlignVertical]: { figmaKey: 'textAlignVertical', type: 'enum', enumMap: { TOP: 'TOP', CENTER: 'CENTER', BOTTOM: 'BOTTOM' } },
  [PROPS.textAutoResize]: { figmaKey: 'textAutoResize', type: 'enum', enumMap: { NONE: 'NONE', WIDTH_AND_HEIGHT: 'WIDTH_AND_HEIGHT', HEIGHT: 'HEIGHT', TRUNCATE: 'TRUNCATE' } },
  [PROPS.lineHeight]: { figmaKey: 'lineHeight', type: 'scalar', min: 0, max: 1000 },
  [PROPS.letterSpacing]: { figmaKey: 'letterSpacing', type: 'scalar', min: -100, max: 1000 },
  [PROPS.textCase]: { figmaKey: 'textCase', type: 'enum', enumMap: { ORIGINAL: 'ORIGINAL', UPPER: 'UPPER', LOWER: 'LOWER', TITLE: 'TITLE', SMALL_CAPS: 'SMALL_CAPS', SMALL_CAPS_FORCED: 'SMALL_CAPS_FORCED' } },
  [PROPS.textDecoration]: { figmaKey: 'textDecoration', type: 'enum', enumMap: { NONE: 'NONE', UNDERLINE: 'UNDERLINE', STRIKETHROUGH: 'STRIKETHROUGH' } },
  [PROPS.textTruncation]: { figmaKey: 'textTruncation', type: 'enum', enumMap: { DISABLED: 'DISABLED', ENDING: 'ENDING' }, defaultValue: 'DISABLED' },
  [PROPS.maxLines]: { figmaKey: 'maxLines', type: 'scalar', min: 1, max: 1000 },
  [PROPS.paragraphSpacing]: { figmaKey: 'paragraphSpacing', type: 'scalar', min: 0, max: 1000 },
  [PROPS.paragraphIndent]: { figmaKey: 'paragraphIndent', type: 'scalar', min: 0, max: 1000 },

  // Previously missing metadata (PROPS defined but PROP_METADATA was absent → serialization broken)
  [PROPS.rotation]: { figmaKey: 'rotation', type: 'scalar', defaultValue: 0, min: -360, max: 360 },
  [PROPS.strokeAlign]: { figmaKey: 'strokeAlign', type: 'enum', enumMap: { INSIDE: 'INSIDE', OUTSIDE: 'OUTSIDE', CENTER: 'CENTER' }, defaultValue: 'INSIDE' },
  [PROPS.strokeJoin]: { figmaKey: 'strokeJoin', type: 'enum', enumMap: { MITER: 'MITER', BEVEL: 'BEVEL', ROUND: 'ROUND' }, defaultValue: 'MITER' },
  [PROPS.strokeCap]: { figmaKey: 'strokeCap', type: 'enum', enumMap: { NONE: 'NONE', ROUND: 'ROUND', SQUARE: 'SQUARE', ARROW_LINES: 'ARROW_LINES', ARROW_EQUILATERAL: 'ARROW_EQUILATERAL' }, defaultValue: 'NONE' },
  [PROPS.dashPattern]: { figmaKey: 'dashPattern', type: 'array', defaultValue: [] },
  [PROPS.strokeTopWeight]: { figmaKey: 'strokeTopWeight', type: 'scalar', min: 0, max: 100 },
  [PROPS.strokeRightWeight]: { figmaKey: 'strokeRightWeight', type: 'scalar', min: 0, max: 100 },
  [PROPS.strokeBottomWeight]: { figmaKey: 'strokeBottomWeight', type: 'scalar', min: 0, max: 100 },
  [PROPS.strokeLeftWeight]: { figmaKey: 'strokeLeftWeight', type: 'scalar', min: 0, max: 100 },
  [PROPS.blendMode]: { figmaKey: 'blendMode', type: 'enum', enumMap: {
    PASS_THROUGH: 'PASS_THROUGH', NORMAL: 'NORMAL', DARKEN: 'DARKEN', MULTIPLY: 'MULTIPLY',
    LINEAR_BURN: 'LINEAR_BURN', COLOR_BURN: 'COLOR_BURN', LIGHTEN: 'LIGHTEN', SCREEN: 'SCREEN',
    LINEAR_DODGE: 'LINEAR_DODGE', COLOR_DODGE: 'COLOR_DODGE', OVERLAY: 'OVERLAY',
    SOFT_LIGHT: 'SOFT_LIGHT', HARD_LIGHT: 'HARD_LIGHT', DIFFERENCE: 'DIFFERENCE',
    EXCLUSION: 'EXCLUSION', HUE: 'HUE', SATURATION: 'SATURATION', COLOR: 'COLOR', LUMINOSITY: 'LUMINOSITY',
  }, defaultValue: 'PASS_THROUGH' },
  [PROPS.cornerSmoothing]: { figmaKey: 'cornerSmoothing', type: 'scalar', defaultValue: 0, min: 0, max: 1 },

  // Frame Clipping & Wrap
  [PROPS.clipsContent]: { figmaKey: 'clipsContent', type: 'enum', enumMap: { 'true': 'true', 'false': 'false' }, defaultValue: false },
  [PROPS.layoutWrap]: { figmaKey: 'layoutWrap', type: 'enum', enumMap: { WRAP: 'WRAP', NO_WRAP: 'NO_WRAP' }, defaultValue: 'NO_WRAP' },
  [PROPS.strokesIncludedInLayout]: { figmaKey: 'strokesIncludedInLayout', type: 'scalar', defaultValue: false },
  [PROPS.itemReverseZIndex]: { figmaKey: 'itemReverseZIndex', type: 'scalar', defaultValue: false },
  [PROPS.minWidth]: { figmaKey: 'minWidth', type: 'scalar', min: 0, max: 10000 },
  [PROPS.maxWidth]: { figmaKey: 'maxWidth', type: 'scalar', min: 0, max: 10000 },
  [PROPS.minHeight]: { figmaKey: 'minHeight', type: 'scalar', min: 0, max: 10000 },
  [PROPS.maxHeight]: { figmaKey: 'maxHeight', type: 'scalar', min: 0, max: 10000 },
  [PROPS.constrainProportions]: { figmaKey: 'constrainProportions', type: 'scalar', defaultValue: false },

  // Virtual
  [PROPS.semantic]: { figmaKey: 'semantic', type: 'virtual' },
  [PROPS.variant]: { figmaKey: 'variant', type: 'virtual' },
  [PROPS.iconName]: { figmaKey: 'iconName', type: 'virtual' },
};

// ── Property scope: node-type whitelist ──

/** Properties exclusive to TEXT nodes — invalid on frames/shapes/vectors */
export const TEXT_ONLY_PROPS: ReadonlySet<string> = new Set([
  PROPS.characters, PROPS.fontName, PROPS.fontSize, PROPS.fontWeight, PROPS.fontFamily,
  PROPS.textAlignHorizontal, PROPS.textAlignVertical, PROPS.textAutoResize,
  PROPS.lineHeight, PROPS.letterSpacing, PROPS.textCase, PROPS.textDecoration,
  PROPS.textTruncation, PROPS.maxLines, PROPS.paragraphSpacing, PROPS.paragraphIndent,
]);

/** All property keys accepted by the system (canonical + virtuals).
 *  Anything not in this set is unknown/unsupported and should be dropped. */
export const KNOWN_PROP_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(PROP_METADATA),
  ...Object.values(PROPS),
  ...Object.values(PROP_METADATA).map(m => m.figmaKey),
  // Style reference properties — handled by styleRefHandler
  'textStyle', 'fillStyle', 'strokeStyle', 'effectStyle',
]);

// Derived Types
export type FigmaProp = typeof PROPS[keyof typeof PROPS];

export const NODE_TYPES = {
  FRAME: 'FRAME',
  TEXT: 'TEXT',
  RECTANGLE: 'RECTANGLE',
  VECTOR: 'VECTOR',
  LINE: 'LINE',
  ELLIPSE: 'ELLIPSE',
  GROUP: 'GROUP',
  SECTION: 'SECTION',
  ICON: 'ICON', // Virtual type supported by our renderer
} as const;

export const LAYOUT_MODES = {
  HORIZONTAL: 'HORIZONTAL',
  VERTICAL: 'VERTICAL',
  NONE: 'NONE',
} as const;

export const SIZING_MODES = {
  FIXED: 'FIXED',
  FILL: 'FILL',
  HUG: 'HUG',
} as const;

export const STROKE_ALIGNS = {
  INSIDE: 'INSIDE',
  OUTSIDE: 'OUTSIDE',
  CENTER: 'CENTER',
} as const;

/**
 * Shared JSON Schema fragment for text/typography properties.
 * Import and spread into tool definition `props.properties` to keep schemas DRY.
 */
/**
 * Get all accepted input keys for an enum property (including aliases).
 * Use for Valibot picklists ("宽进": accept aliases like AUTO/STRETCH).
 */
export function getEnumInputs(prop: string): string[] {
  const meta = PROP_METADATA[prop];
  if (!meta?.enumMap) return [];
  return Object.keys(meta.enumMap);
}

/**
 * Get unique canonical output values for an enum property.
 * Use for strict output validation.
 */
export function getCanonicalValues(prop: string): string[] {
  const meta = PROP_METADATA[prop];
  if (!meta?.enumMap) return [];
  return [...new Set(Object.values(meta.enumMap))];
}

export const TEXT_PROPS_SCHEMA = {
  characters: { type: 'string', description: 'Text content (TEXT nodes only)' },
  fontSize: { type: 'number', description: 'Font size in px' },
  fontWeight: { type: 'string', description: 'e.g. "Bold", "Medium", "Regular"' },
  fontFamily: { type: 'string', description: 'Font family name. Supports any Google Font (e.g. "Roboto", "Poppins", "Noto Sans SC"). Defaults to "Inter".' },
  lineHeight: { type: 'number', description: 'Line height in px (or {value, unit:"PERCENT"} for %)' },
  letterSpacing: { type: 'number', description: 'Letter spacing in px' },
  textAlignHorizontal: { type: 'string', description: 'LEFT | CENTER | RIGHT | JUSTIFIED' },
  textAlignVertical: { type: 'string', description: 'TOP | CENTER | BOTTOM' },
  textCase: { type: 'string', description: 'ORIGINAL | UPPER | LOWER | TITLE | SMALL_CAPS | SMALL_CAPS_FORCED' },
  textDecoration: { type: 'string', description: 'NONE | UNDERLINE | STRIKETHROUGH' },
  textAutoResize: { type: 'string', description: 'NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE' },
  textTruncation: { type: 'string', description: 'DISABLED | ENDING. Use ENDING for ellipsis ("...") truncation.' },
  maxLines: { type: 'number', description: 'Max visible lines before truncation. Requires textTruncation=ENDING and textAutoResize=TRUNCATE.' },
  paragraphSpacing: { type: 'number', description: 'Space between paragraphs in px' },
  paragraphIndent: { type: 'number', description: 'First-line indent in px' },
} as const;


