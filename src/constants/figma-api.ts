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
  topLeftRadius: 'topLeftRadius',
  topRightRadius: 'topRightRadius',
  bottomLeftRadius: 'bottomLeftRadius',
  bottomRightRadius: 'bottomRightRadius',
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

// ── Re-exports from figma-property-registry (canonical location) ──
// PROP_METADATA is a backward-compat alias. New code should import
// PROPERTY_META directly from figma-property-registry.
import { PROPERTY_META, PROPERTY_REGISTRY, BLACKLIST, type PropMeta, type SizingConstraint, getEnumInputs, getCanonicalValues } from './figma-property-registry';
export { PROPERTY_META, PROPERTY_REGISTRY, BLACKLIST, type PropMeta, type SizingConstraint, getEnumInputs, getCanonicalValues };

/** @deprecated Use PROPERTY_META from figma-property-registry. */
export type PropDefinition = PropMeta & { readonly figmaKey: string };

/** @deprecated Use PROPERTY_META from figma-property-registry. Derived shim. */
export const PROP_METADATA: Record<string, PropDefinition> = Object.fromEntries(
  Object.entries(PROPERTY_META).map(([dslKey, meta]) => [
    dslKey,
    { ...meta, figmaKey: meta.figmaKey || dslKey } as PropDefinition,
  ])
);


// ── Property scope: node-type whitelist ──

/** Properties exclusive to TEXT nodes — invalid on frames/shapes/vectors */
export const TEXT_ONLY_PROPS: ReadonlySet<string> = new Set([
  PROPS.characters, PROPS.fontName, PROPS.fontSize, PROPS.fontWeight, PROPS.fontFamily,
  PROPS.textAlignHorizontal, PROPS.textAlignVertical, PROPS.textAutoResize,
  PROPS.lineHeight, PROPS.letterSpacing, PROPS.textCase, PROPS.textDecoration,
  PROPS.textTruncation, PROPS.maxLines, PROPS.paragraphSpacing, PROPS.paragraphIndent,
]);

/** All property keys accepted by the system (canonical + virtuals + registry-discovered).
 *  Anything not in this set is unknown/unsupported and should be dropped. */
export const KNOWN_PROP_KEYS: ReadonlySet<string> = buildKnownPropKeys();

function buildKnownPropKeys(): ReadonlySet<string> {
  const keys = new Set([
    ...Object.keys(PROP_METADATA),
    ...Object.values(PROPS),
    ...Object.values(PROP_METADATA).map(m => m.figmaKey),
    // Style reference properties — handled by styleRefHandler
    'textStyle', 'fillStyle', 'strokeStyle', 'effectStyle',
    // Hyperlink — handled by hyperlinkHandler
    'hyperlink',
  ]);

  // Add all properties discovered from plugin-api.d.ts registry
  for (const props of Object.values(PROPERTY_REGISTRY)) {
    for (const p of props) {
      if (!BLACKLIST.has(p.key)) keys.add(p.key);
    }
  }
  return keys;
}

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
  COMPONENT: 'COMPONENT',
  COMPONENT_SET: 'COMPONENT_SET',
  INSTANCE: 'INSTANCE',
  STAR: 'STAR',
  POLYGON: 'POLYGON',
  BOOLEAN_OPERATION: 'BOOLEAN_OPERATION',
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
// getEnumInputs and getCanonicalValues are re-exported from figma-property-registry above

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


