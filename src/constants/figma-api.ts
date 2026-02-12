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
  cornerRadius: 'cornerRadius',
  cornerSmoothing: 'cornerSmoothing',
  effects: 'effects',

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

  // ==========================
  // Component / Meta
  // ==========================
  iconName: 'iconName',                   // Virtual: Icon lookup key
  semantic: 'semantic',                   // Virtual: Design System component role
  variant: 'variant',                     // Virtual: Design System variant
  svgContent: 'svgContent',               // Virtual: Embedded SVG data
  rotation: 'rotation',                   // New: Rotation in degrees
} as const;

/**
 * Property Metadata for Unified Mapping (Figma <-> DSL)
 * This centralizes how each property is extracted and rendered.
 */
export interface PropDefinition {
  readonly figmaKey: string;
  readonly type: 'scalar' | 'color' | 'enum' | 'object' | 'virtual' | 'array' | 'string';
  readonly enumMap?: Record<string, string>;
  readonly defaultValue?: any; // [PURE TRUST] Centralized default for data-driven transformation
}

export const PROP_METADATA: Record<string, PropDefinition> = {
  [PROPS.name]: { figmaKey: 'name', type: 'string' },
  [PROPS.visible]: { figmaKey: 'visible', type: 'scalar', defaultValue: true },
  [PROPS.opacity]: { figmaKey: 'opacity', type: 'scalar', defaultValue: 1 },
  
  // Layout
  [PROPS.layoutMode]: { 
    figmaKey: 'layoutMode', 
    type: 'enum', 
    enumMap: { 'VERTICAL': 'VERTICAL', 'HORIZONTAL': 'HORIZONTAL', 'NONE': 'NONE' },
    defaultValue: 'NONE'
  },
  [PROPS.layoutSizingHorizontal]: { figmaKey: 'layoutSizingHorizontal', type: 'enum', defaultValue: 'FIXED' },
  [PROPS.layoutSizingVertical]: { figmaKey: 'layoutSizingVertical', type: 'enum', defaultValue: 'FIXED' },
  [PROPS.primaryAxisAlignItems]: { figmaKey: 'primaryAxisAlignItems', type: 'enum', defaultValue: 'MIN' },
  [PROPS.counterAxisAlignItems]: { figmaKey: 'counterAxisAlignItems', type: 'enum', defaultValue: 'MIN' },
  [PROPS.gap]: { figmaKey: 'itemSpacing', type: 'scalar', defaultValue: 0 }, // Note: itemSpacing in Figma API
  [PROPS.paddingTop]: { figmaKey: 'paddingTop', type: 'scalar', defaultValue: 0 },
  [PROPS.paddingRight]: { figmaKey: 'paddingRight', type: 'scalar', defaultValue: 0 },
  [PROPS.paddingBottom]: { figmaKey: 'paddingBottom', type: 'scalar', defaultValue: 0 },
  [PROPS.paddingLeft]: { figmaKey: 'paddingLeft', type: 'scalar', defaultValue: 0 },
  [PROPS.layoutGrow]: { figmaKey: 'layoutGrow', type: 'scalar', defaultValue: 0 },
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
  [PROPS.width]: { figmaKey: 'width', type: 'scalar' },
  [PROPS.height]: { figmaKey: 'height', type: 'scalar' },

  // Styling
  [PROPS.fills]: { figmaKey: 'fills', type: 'color', defaultValue: [] },
  [PROPS.strokes]: { figmaKey: 'strokes', type: 'color', defaultValue: [] },
  [PROPS.strokeWeight]: { figmaKey: 'strokeWeight', type: 'scalar', defaultValue: 0 },
  [PROPS.cornerRadius]: { figmaKey: 'cornerRadius', type: 'scalar', defaultValue: 0 },
  [PROPS.effects]: { figmaKey: 'effects', type: 'array', defaultValue: [] },

  // Text
  [PROPS.characters]: { figmaKey: 'characters', type: 'string' },
  [PROPS.fontSize]: { figmaKey: 'fontSize', type: 'scalar' },
  [PROPS.fontWeight]: { figmaKey: 'fontWeight', type: 'virtual' }, // Maps to fontName.style
  [PROPS.fontFamily]: { figmaKey: 'fontFamily', type: 'virtual' }, // Maps to fontName.family
  
  // Virtual
  [PROPS.semantic]: { figmaKey: 'semantic', type: 'virtual' },
  [PROPS.variant]: { figmaKey: 'variant', type: 'virtual' },
  [PROPS.iconName]: { figmaKey: 'iconName', type: 'virtual' },
};

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


