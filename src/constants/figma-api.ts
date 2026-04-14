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

// ── Re-exports from figma-property-registry (canonical location) ──
// PROP_METADATA is a backward-compat alias. New code should import
// PROPERTY_META directly from figma-property-registry.
import { PROPERTY_META, PROPERTY_REGISTRY, VISUAL_ROLES, type PropMeta, type SizingConstraint, getEnumInputs, getCanonicalValues } from './figma-property-registry';
export { PROPERTY_META, PROPERTY_REGISTRY, VISUAL_ROLES, type PropMeta, type SizingConstraint, getEnumInputs, getCanonicalValues };

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
  'characters', 'fontName', 'fontSize', 'fontWeight', 'fontFamily',
  'textAlignHorizontal', 'textAlignVertical', 'textAutoResize',
  'lineHeight', 'letterSpacing', 'textCase', 'textDecoration',
  'textTruncation', 'maxLines', 'paragraphSpacing', 'paragraphIndent',
]);

/** All property keys accepted by the system (canonical + virtuals + registry-discovered).
 *  Anything not in this set is unknown/unsupported and should be dropped. */
export const KNOWN_PROP_KEYS: ReadonlySet<string> = buildKnownPropKeys();

function buildKnownPropKeys(): ReadonlySet<string> {
  const keys = new Set([
    ...Object.keys(PROP_METADATA),
    ...Object.values(PROP_METADATA).map(m => m.figmaKey),
    // Style reference properties — handled by styleRefHandler
    'textStyle', 'fillStyle', 'strokeStyle', 'effectStyle',
    // Hyperlink — handled by hyperlinkHandler
    'hyperlink',
  ]);

  // Add all design-visible properties discovered from plugin-api.d.ts registry
  for (const props of Object.values(PROPERTY_REGISTRY)) {
    for (const p of props) {
      if (VISUAL_ROLES.has(p.role)) keys.add(p.key);
    }
  }
  return keys;
}

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
  GRID: 'GRID',
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


